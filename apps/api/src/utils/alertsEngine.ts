import { prisma } from "../prisma";
import { computeCaStatus, computeLifecycleStatus } from "./ppeStatus";

// Recalcula os alertas abertos da organização com base no estado atual do sistema:
// estoque (por filial), validade de CA, vida útil dos EPIs entregues e confirmações pendentes.
// Idempotente: usa (tipo, referenceType, referenceId) como chave para não duplicar alertas.
export async function refreshAlerts(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) return;
  const thresholds = { proximo: org.alertDaysProximo, atencao: org.alertDaysAtencao, critico: org.alertDaysCritico };
  const now = new Date();

  const toCreate: {
    tipo: string;
    prioridade: "CRITICO" | "ATENCAO" | "INFORMACAO";
    titulo: string;
    mensagem: string;
    referenceType: string;
    referenceId: string;
    branchId: string | null;
  }[] = [];

  // Estoque é por filial: um mesmo EPI pode estar zerado no Amazonas e normal no Pará.
  const branchStocks = await prisma.branchStock.findMany({
    where: { organizationId, ppeItem: { status: "ATIVO" } },
    include: { ppeItem: true, branch: true },
  });

  for (const stock of branchStocks) {
    if (stock.branch.status !== "ATIVO") continue;

    if (stock.estoqueAtual <= 0) {
      toCreate.push({
        tipo: "ESTOQUE_ZERADO",
        prioridade: "CRITICO",
        titulo: `Estoque zerado: ${stock.ppeItem.nome} (${stock.branch.nome})`,
        mensagem: `O EPI "${stock.ppeItem.nome}" está com estoque zerado na filial ${stock.branch.nome}.`,
        referenceType: "BranchStock",
        referenceId: stock.id,
        branchId: stock.branchId,
      });
    } else if (stock.estoqueAtual < stock.estoqueMinimo) {
      toCreate.push({
        tipo: "ESTOQUE_MINIMO",
        prioridade: "ATENCAO",
        titulo: `Estoque abaixo do mínimo: ${stock.ppeItem.nome} (${stock.branch.nome})`,
        mensagem: `Estoque atual (${stock.estoqueAtual}) está abaixo do mínimo (${stock.estoqueMinimo}) na filial ${stock.branch.nome}.`,
        referenceType: "BranchStock",
        referenceId: stock.id,
        branchId: stock.branchId,
      });
    }
  }

  // Validade de CA é uma característica do EPI no catálogo, não de uma filial.
  const ppeItems = await prisma.ppeItem.findMany({ where: { organizationId, status: "ATIVO" } });
  for (const item of ppeItems) {
    const caStatus = computeCaStatus(item.caValidade, now, thresholds);
    if (caStatus === "VENCIDO") {
      toCreate.push({
        tipo: "CA_VENCIDO",
        prioridade: "CRITICO",
        titulo: `CA vencido: ${item.nome}`,
        mensagem: `O Certificado de Aprovação do EPI "${item.nome}" (CA ${item.ca}) está vencido desde ${item.caValidade.toLocaleDateString("pt-BR")}.`,
        referenceType: "PpeItem",
        referenceId: item.id,
        branchId: null,
      });
    } else if (caStatus === "PROXIMO_VENCIMENTO") {
      toCreate.push({
        tipo: "CA_PROXIMO_VENCIMENTO",
        prioridade: "ATENCAO",
        titulo: `CA próximo do vencimento: ${item.nome}`,
        mensagem: `O CA ${item.ca} do EPI "${item.nome}" vence em ${item.caValidade.toLocaleDateString("pt-BR")}.`,
        referenceType: "PpeItem",
        referenceId: item.id,
        branchId: null,
      });
    }
  }

  const confirmedDeliveries = await prisma.delivery.findMany({
    where: { organizationId, status: "CONFIRMADA" },
    include: { items: { include: { ppeItem: true } }, employee: { include: { branch: true } } },
  });
  const returns = await prisma.ppeReturn.findMany({ where: { organizationId } });
  const returnedIds = new Set(returns.map((r) => r.deliveryItemId).filter(Boolean));

  for (const delivery of confirmedDeliveries) {
    for (const item of delivery.items) {
      // Item já devolvido ou substituído por entrega mais nova não gera alerta.
      if (returnedIds.has(item.id) || item.status === "SUBSTITUIDO") continue;
      const status = computeLifecycleStatus(item.dataPrevistaTroca, now, thresholds);
      if (status === "VENCIDO") {
        toCreate.push({
          tipo: "EPI_VENCIDO",
          prioridade: "CRITICO",
          titulo: `EPI vencido: ${item.ppeItem.nome}`,
          mensagem: `O EPI "${item.ppeItem.nome}" entregue a ${delivery.employee.nomeCompleto} (${delivery.employee.branch?.nome ?? "sem filial"}) venceu em ${item.dataPrevistaTroca.toLocaleDateString("pt-BR")}.`,
          referenceType: "DeliveryItem",
          referenceId: item.id,
          branchId: delivery.branchId ?? delivery.employee.branchId,
        });
      } else if (status === "CRITICO" || status === "PROXIMO_DA_TROCA") {
        toCreate.push({
          tipo: "EPI_PROXIMO_TROCA",
          prioridade: status === "CRITICO" ? "ATENCAO" : "INFORMACAO",
          titulo: `Troca próxima: ${item.ppeItem.nome}`,
          mensagem: `O EPI "${item.ppeItem.nome}" de ${delivery.employee.nomeCompleto} deve ser trocado em ${item.dataPrevistaTroca.toLocaleDateString("pt-BR")}.`,
          referenceType: "DeliveryItem",
          referenceId: item.id,
          branchId: delivery.branchId ?? delivery.employee.branchId,
        });
      }
    }
  }

  const pendingDeliveries = await prisma.delivery.findMany({
    where: { organizationId, status: "PENDENTE" },
    include: { employee: true },
  });
  for (const delivery of pendingDeliveries) {
    toCreate.push({
      tipo: "ENTREGA_PENDENTE_CONFIRMACAO",
      prioridade: "INFORMACAO",
      titulo: `Confirmação pendente: ${delivery.employee.nomeCompleto}`,
      mensagem: `A entrega para ${delivery.employee.nomeCompleto} está aguardando confirmação eletrônica de recebimento.`,
      referenceType: "Delivery",
      referenceId: delivery.id,
      branchId: delivery.branchId,
    });
  }

  const existingOpen = await prisma.alert.findMany({ where: { organizationId, status: "ABERTO" } });
  const existingKeys = new Set(existingOpen.map((a) => `${a.tipo}:${a.referenceType}:${a.referenceId}`));
  const freshKeys = new Set(toCreate.map((a) => `${a.tipo}:${a.referenceType}:${a.referenceId}`));

  const toResolve = existingOpen.filter((a) => !freshKeys.has(`${a.tipo}:${a.referenceType}:${a.referenceId}`));
  const toInsert = toCreate.filter((a) => !existingKeys.has(`${a.tipo}:${a.referenceType}:${a.referenceId}`));

  if (toResolve.length > 0) {
    await prisma.alert.updateMany({
      where: { id: { in: toResolve.map((a) => a.id) } },
      data: { status: "RESOLVIDO", resolvedAt: now },
    });
  }

  if (toInsert.length === 0) return;

  const insertedAlerts = await Promise.all(
    toInsert.map((a) => prisma.alert.create({ data: { ...a, organizationId, tipo: a.tipo as never } }))
  );

  await notifyUsersForNewAlerts(organizationId, insertedAlerts);
}

// Mapeia cada tipo de alerta para os perfis que devem ser avisados por notificação.
const ALERT_NOTIFY_ROLES: Record<string, ("ADMIN" | "ALMOXARIFADO" | "SEGURANCA_TRABALHO")[]> = {
  ESTOQUE_MINIMO: ["ALMOXARIFADO", "ADMIN"],
  ESTOQUE_ZERADO: ["ALMOXARIFADO", "ADMIN"],
  CA_VENCIDO: ["SEGURANCA_TRABALHO", "ADMIN"],
  CA_PROXIMO_VENCIMENTO: ["SEGURANCA_TRABALHO", "ADMIN"],
  EPI_VENCIDO: ["SEGURANCA_TRABALHO", "ADMIN"],
  EPI_PROXIMO_TROCA: ["SEGURANCA_TRABALHO", "ADMIN"],
  ENTREGA_PENDENTE_CONFIRMACAO: ["ALMOXARIFADO", "ADMIN"],
};

const ALERT_LINK: Record<string, string> = {
  ESTOQUE_MINIMO: "/estoque",
  ESTOQUE_ZERADO: "/estoque",
  CA_VENCIDO: "/epis",
  CA_PROXIMO_VENCIMENTO: "/epis",
  EPI_VENCIDO: "/trocas",
  EPI_PROXIMO_TROCA: "/trocas",
  ENTREGA_PENDENTE_CONFIRMACAO: "/entregas",
};

async function notifyUsersForNewAlerts(
  organizationId: string,
  alerts: { id: string; tipo: string; prioridade: string; titulo: string; mensagem: string; branchId: string | null }[]
) {
  const relevantRoles = Array.from(new Set(alerts.flatMap((a) => ALERT_NOTIFY_ROLES[a.tipo] ?? [])));
  if (relevantRoles.length === 0) return;

  const users = await prisma.user.findMany({
    where: { organizationId, status: "ATIVO", role: { in: relevantRoles } },
    select: { id: true, role: true, branchId: true },
  });
  if (users.length === 0) return;

  const notifications: { organizationId: string; userId: string; title: string; message: string; link: string }[] = [];
  for (const alert of alerts) {
    const roles = ALERT_NOTIFY_ROLES[alert.tipo];
    if (!roles) continue;

    const recipients = users.filter((u) => {
      if (!roles.includes(u.role as (typeof roles)[number])) return false;
      // Usuário restrito a uma filial só é notificado sobre alertas da própria filial
      // (ou sobre alertas corporativos, que não têm filial).
      if (u.branchId && alert.branchId && u.branchId !== alert.branchId) return false;
      return true;
    });

    for (const user of recipients) {
      notifications.push({
        organizationId,
        userId: user.id,
        title: alert.titulo,
        message: alert.mensagem,
        link: ALERT_LINK[alert.tipo] ?? "/alertas",
      });
    }
  }

  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications });
  }
}
