import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole, requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, forbidden, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";
import { computeLifecycleStatus, effectiveItemStatus, computeCaStatus } from "../utils/ppeStatus";
import { imagemBufferSeguraParaPdf } from "../utils/imageSafety";
import { namesMatch } from "../utils/nameMatch";
import { generateDeliveryTermPdf } from "../utils/pdf";
import { uploadConfirmationPhoto, uploadDocument } from "../utils/upload";
import { armazenamento, nomeUnico } from "../utils/storage";
import { applyStockMovement } from "../utils/stock";
import { assertBranchAllowed, resolveBranchFilter } from "../utils/branchScope";

export const deliveriesRouter = Router();
deliveriesRouter.use(requireAuth, requireWriteRole("RH", "GERENTE"));

async function getThresholds(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  return { proximo: org!.alertDaysProximo, atencao: org!.alertDaysAtencao, critico: org!.alertDaysCritico };
}

// Quando o colaborador recebe de novo um EPI que já tinha, o item anterior vira
// SUBSTITUIDO. Se todos os itens de uma entrega antiga forem substituídos, a
// própria entrega passa a SUBSTITUIDA — preservando o histórico sem contar duas vezes.
async function marcarEntregasAnterioresComoSubstituidas(
  tx: Prisma.TransactionClient,
  employeeId: string,
  entregaAtualId: string,
  ppeItemIds: string[]
): Promise<number> {
  if (ppeItemIds.length === 0) return 0;

  const anteriores = await tx.deliveryItem.findMany({
    where: {
      ppeItemId: { in: ppeItemIds },
      status: { notIn: ["DEVOLVIDO", "SUBSTITUIDO"] },
      deliveryId: { not: entregaAtualId },
      delivery: { employeeId, status: "CONFIRMADA" },
    },
    select: { id: true, deliveryId: true },
  });
  if (anteriores.length === 0) return 0;

  await tx.deliveryItem.updateMany({
    where: { id: { in: anteriores.map((i) => i.id) } },
    data: { status: "SUBSTITUIDO" },
  });

  for (const deliveryId of new Set(anteriores.map((i) => i.deliveryId))) {
    const restantes = await tx.deliveryItem.count({
      where: { deliveryId, status: { notIn: ["DEVOLVIDO", "SUBSTITUIDO"] } },
    });
    if (restantes === 0) {
      await tx.delivery.update({ where: { id: deliveryId }, data: { status: "SUBSTITUIDA" } });
    }
  }

  return anteriores.length;
}

// Mesma ideia da função acima, mas decidindo quem substitui quem pela DATA, e não
// pela ordem em que foi digitado. Numa ficha de papel importada a data vem do
// papel, e as fichas raramente são digitadas em ordem: a de 2024 pode entrar
// depois da de 2025. Pela ordem de digitação, a ficha de 2024 marcaria a de 2025
// como substituída e o colaborador apareceria com um EPI vencido que ele já trocou.
//
// Devolve também os EPIs em que a ficha recém-importada já nasce substituída,
// porque o colaborador recebeu aquele mesmo EPI numa data posterior.
async function aplicarSubstituicaoPorData(
  tx: Prisma.TransactionClient,
  employeeId: string,
  entregaAtualId: string,
  ppeItemIds: string[],
  dataEntrega: Date
): Promise<{ anterioresSubstituidos: number; jaSuperados: Set<string> }> {
  if (ppeItemIds.length === 0) return { anterioresSubstituidos: 0, jaSuperados: new Set() };

  const outros = await tx.deliveryItem.findMany({
    where: {
      ppeItemId: { in: ppeItemIds },
      status: { notIn: ["DEVOLVIDO", "SUBSTITUIDO"] },
      deliveryId: { not: entregaAtualId },
      delivery: { employeeId, status: "CONFIRMADA" },
    },
    select: { id: true, deliveryId: true, ppeItemId: true, dataEntrega: true },
  });

  const anteriores = outros.filter((i) => i.dataEntrega < dataEntrega);
  const posteriores = outros.filter((i) => i.dataEntrega >= dataEntrega);

  if (anteriores.length > 0) {
    await tx.deliveryItem.updateMany({
      where: { id: { in: anteriores.map((i) => i.id) } },
      data: { status: "SUBSTITUIDO" },
    });
    for (const deliveryId of new Set(anteriores.map((i) => i.deliveryId))) {
      const restantes = await tx.deliveryItem.count({
        where: { deliveryId, status: { notIn: ["DEVOLVIDO", "SUBSTITUIDO"] } },
      });
      if (restantes === 0) {
        await tx.delivery.update({ where: { id: deliveryId }, data: { status: "SUBSTITUIDA" } });
      }
    }
  }

  return { anterioresSubstituidos: anteriores.length, jaSuperados: new Set(posteriores.map((i) => i.ppeItemId)) };
}

// ===================== PREPARAÇÃO INTELIGENTE DE ENTREGA =====================
// Analisa o cargo do colaborador, a matriz Cargo x EPI, o que já foi entregue e o estoque disponível.
deliveriesRouter.get("/prepare/:employeeId", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const employee = await prisma.employee.findFirst({
      where: { id: req.params.employeeId, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        branch: true,
        position: { include: { requirements: { include: { ppeItem: { include: { category: true } } } } } },
      },
    });
    if (!employee) throw notFound("Colaborador não encontrado.");
    if (!employee.branchId) throw badRequest("Colaborador sem filial definida. Vincule-o a uma filial antes de entregar EPIs.");

    const now = new Date();
    const thresholds = await getThresholds(organizationId);

    // Estoque é por filial: considera apenas o almoxarifado da filial do colaborador.
    const branchStocks = await prisma.branchStock.findMany({ where: { branchId: employee.branchId } });
    const stockByItem = new Map(branchStocks.map((s) => [s.ppeItemId, s.estoqueAtual]));

    const deliveries = await prisma.delivery.findMany({
      where: { employeeId: employee.id, status: "CONFIRMADA" },
      include: { items: true },
    });
    const returns = await prisma.ppeReturn.findMany({ where: { employeeId: employee.id } });
    const returnedDeliveryItemIds = new Set(returns.map((r) => r.deliveryItemId).filter(Boolean));

    const currentByPpeItem = new Map<string, { deliveryItemId: string; dataPrevistaTroca: Date; dataEntrega: Date }>();
    for (const d of deliveries) {
      for (const item of d.items) {
        if (returnedDeliveryItemIds.has(item.id) || item.status === "SUBSTITUIDO") continue;
        const current = currentByPpeItem.get(item.ppeItemId);
        if (!current || item.dataEntrega > current.dataEntrega) {
          currentByPpeItem.set(item.ppeItemId, { deliveryItemId: item.id, dataPrevistaTroca: item.dataPrevistaTroca, dataEntrega: item.dataEntrega });
        }
      }
    }

    const requirements = employee.position?.requirements ?? [];
    const analysis = requirements.map((req) => {
      const current = currentByPpeItem.get(req.ppeItemId);
      let status: "REGULAR" | "PROXIMO_DA_TROCA" | "CRITICO" | "VENCIDO" | "NUNCA_ENTREGUE" = "NUNCA_ENTREGUE";
      if (current) status = computeLifecycleStatus(current.dataPrevistaTroca, now, thresholds);

      // Uniforme sem CA nunca vence, então não entra no bloqueio por CA.
      const caStatus = computeCaStatus(req.ppeItem.caValidade, now, thresholds);
      const needsDelivery = status !== "REGULAR";
      const estoqueDisponivel = stockByItem.get(req.ppeItemId) ?? 0;

      return {
        requirementId: req.id,
        ppeItem: req.ppeItem,
        quantidadeExigida: req.quantidade,
        vidaUtilDias: req.vidaUtilDiasOverride ?? req.ppeItem.vidaUtilDias,
        status,
        caStatus,
        estoqueDisponivel,
        estoqueSuficiente: estoqueDisponivel >= req.quantidade,
        podeEntregar: needsDelivery && caStatus === "VALIDO" && estoqueDisponivel >= req.quantidade && req.ppeItem.status === "ATIVO",
        ultimaEntrega: current ? { dataEntrega: current.dataEntrega, dataPrevistaTroca: current.dataPrevistaTroca } : null,
      };
    });

    res.json({
      employee: {
        id: employee.id,
        nomeCompleto: employee.nomeCompleto,
        status: employee.status,
        position: employee.position,
        branch: employee.branch,
      },
      itensSugeridos: analysis,
    });
  } catch (err) {
    next(err);
  }
});

// ===================== TROCAS (EPIs próximos/críticos/vencidos) =====================
deliveriesRouter.get("/trocas/lista", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const thresholds = await getThresholds(organizationId);
    const now = new Date();

    const employeeId = req.query.employeeId as string | undefined;
    const ppeItemId = req.query.ppeItemId as string | undefined;
    const departmentId = req.query.departmentId as string | undefined;
    const positionId = req.query.positionId as string | undefined;
    const statusFilter = req.query.status as string | undefined;

    const deliveries = await prisma.delivery.findMany({
      where: {
        organizationId,
        status: "CONFIRMADA",
        ...resolveBranchFilter(req.user!, req.query.branchId as string | undefined),
        ...(employeeId ? { employeeId } : {}),
        ...(departmentId ? { employee: { departmentId } } : {}),
        ...(positionId ? { employee: { positionId } } : {}),
      },
      include: {
        employee: { include: { position: true, department: true, branch: true } },
        items: { where: ppeItemId ? { ppeItemId } : undefined, include: { ppeItem: true } },
      },
    });

    const returns = await prisma.ppeReturn.findMany({ where: { organizationId } });
    const returnedIds = new Set(returns.map((r) => r.deliveryItemId).filter(Boolean));

    const rows = deliveries.flatMap((d) =>
      d.items
        .filter((item) => !returnedIds.has(item.id) && item.status !== "SUBSTITUIDO")
        .map((item) => ({
          deliveryId: d.id,
          employee: {
            id: d.employee.id,
            nomeCompleto: d.employee.nomeCompleto,
            position: d.employee.position,
            department: d.employee.department,
            branch: d.employee.branch,
          },
          ppeItem: item.ppeItem,
          dataEntrega: item.dataEntrega,
          dataPrevistaTroca: item.dataPrevistaTroca,
          status: computeLifecycleStatus(item.dataPrevistaTroca, now, thresholds),
        }))
        .filter((row) => row.status !== "REGULAR")
        .filter((row) => !statusFilter || row.status === statusFilter)
    );

    rows.sort((a, b) => a.dataPrevistaTroca.getTime() - b.dataPrevistaTroca.getTime());
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ===================== LISTAGEM =====================
deliveriesRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status as string | undefined;
    const employeeId = req.query.employeeId as string | undefined;

    const where = {
      organizationId,
      ...resolveBranchFilter(req.user!, req.query.branchId as string | undefined),
      ...(status ? { status: status as never } : {}),
      ...(employeeId ? { employeeId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
        include: {
          employee: { include: { position: true, department: true } },
          branch: true,
          items: { include: { ppeItem: true } },
          confirmation: true,
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.delivery.count({ where }),
    ]);

    // Mesmo cálculo da tela de detalhe: o status do item vem da data de troca.
    const thresholds = await getThresholds(organizationId);
    const now = new Date();
    const comStatusAtual = items.map((d) => ({
      ...d,
      items: d.items.map((item) => ({
        ...item,
        status: effectiveItemStatus(item.status, item.dataPrevistaTroca, now, thresholds),
      })),
    }));

    res.json(buildPageResult(comStatusAtual, total, pagination));
  } catch (err) {
    next(err);
  }
});

deliveriesRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        employee: { include: { position: true, department: true, branch: true } },
        branch: true,
        items: { include: { ppeItem: { include: { category: true } } } },
        confirmation: { include: { handledBy: { select: { id: true, name: true } } } },
        createdBy: { select: { id: true, name: true } },
        canceladoPor: { select: { id: true, name: true } },
      },
    });
    if (!delivery) throw notFound("Entrega não encontrada.");

    // Status do item é calculado na leitura: a data de troca é a fonte da verdade.
    const thresholds = await getThresholds(organizationId);
    const now = new Date();
    res.json({
      ...delivery,
      items: delivery.items.map((item) => ({
        ...item,
        status: effectiveItemStatus(item.status, item.dataPrevistaTroca, now, thresholds),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ===================== CRIAÇÃO DA ENTREGA (BAIXA DE ESTOQUE) =====================
const createSchema = z.object({
  employeeId: z.string().min(1),
  motivo: z.enum(["PRIMEIRA_ENTREGA", "SUBSTITUICAO", "TROCA", "PERDA", "DANIFICACAO", "VENCIMENTO", "ADMISSAO", "OUTRO"]),
  observacoes: z.string().optional().nullable(),
  items: z.array(z.object({ ppeItemId: z.string().min(1), quantidade: z.coerce.number().int().positive() })).min(1),
});

deliveriesRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = createSchema.parse(req.body);

    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId, ...resolveBranchFilter(req.user!) },
      include: { branch: true },
    });
    if (!employee) throw badRequest("Colaborador inválido.");
    if (employee.status !== "ATIVO") throw badRequest(`Não é possível entregar EPIs: colaborador está ${employee.status.toLowerCase()}.`);
    if (!employee.branchId) throw badRequest("Colaborador sem filial definida. Vincule-o a uma filial antes de entregar EPIs.");
    assertBranchAllowed(req.user!, employee.branchId);

    const branchId = employee.branchId;
    const ppeItemIds = data.items.map((i) => i.ppeItemId);
    const ppeItems = await prisma.ppeItem.findMany({ where: { id: { in: ppeItemIds }, organizationId } });
    if (ppeItems.length !== new Set(ppeItemIds).size) throw badRequest("Um ou mais EPIs informados são inválidos.");

    const branchStocks = await prisma.branchStock.findMany({ where: { branchId, ppeItemId: { in: ppeItemIds } } });
    const stockByItem = new Map(branchStocks.map((s) => [s.ppeItemId, s.estoqueAtual]));
    const custoByItem = new Map(branchStocks.map((s) => [s.ppeItemId, s.custoUnitario]));

    // A matriz Cargo x EPI pode definir vida útil própria para o cargo — ela prevalece
    // sobre a vida útil padrão do catálogo no cálculo da data de troca.
    const requisitosDoCargo = employee.positionId
      ? await prisma.positionPpeRequirement.findMany({
          where: { positionId: employee.positionId, ppeItemId: { in: ppeItemIds } },
          select: { ppeItemId: true, vidaUtilDiasOverride: true },
        })
      : [];
    const vidaUtilPorItem = new Map(
      requisitosDoCargo
        .filter((r) => r.vidaUtilDiasOverride != null)
        .map((r) => [r.ppeItemId, r.vidaUtilDiasOverride as number])
    );

    const now = new Date();
    for (const line of data.items) {
      const ppeItem = ppeItems.find((p) => p.id === line.ppeItemId)!;
      const disponivel = stockByItem.get(line.ppeItemId) ?? 0;
      if (ppeItem.status !== "ATIVO") throw badRequest(`O EPI "${ppeItem.nome}" está inativo e não pode ser entregue.`);
      if (ppeItem.caValidade && ppeItem.caValidade < now) {
        throw badRequest(`O EPI "${ppeItem.nome}" possui CA VENCIDO e não pode ser entregue.`);
      }
      if (disponivel < line.quantidade) {
        throw badRequest(
          `Estoque insuficiente para "${ppeItem.nome}" na filial ${employee.branch?.nome ?? ""}. Disponível: ${disponivel}, solicitado: ${line.quantidade}.`
        );
      }
    }

    const delivery = await prisma.$transaction(async (tx) => {
      const created = await tx.delivery.create({
        data: {
          organizationId,
          branchId,
          employeeId: employee.id,
          motivo: data.motivo,
          observacoes: data.observacoes,
          status: "PENDENTE",
          createdById: userId,
        },
      });

      for (const line of data.items) {
        const ppeItem = ppeItems.find((p) => p.id === line.ppeItemId)!;

        await tx.deliveryItem.create({
          data: {
            deliveryId: created.id,
            ppeItemId: ppeItem.id,
            caSnapshot: ppeItem.ca,
            quantidade: line.quantidade,
            // Custo da filial que está entregando (cai para o catálogo se ela ainda não comprou).
            custoUnitarioSnapshot: custoByItem.get(ppeItem.id) ?? ppeItem.custoUnitario,
            dataEntrega: now,
            dataPrevistaTroca: new Date(
              now.getTime() + (vidaUtilPorItem.get(ppeItem.id) ?? ppeItem.vidaUtilDias) * 24 * 60 * 60 * 1000
            ),
            status: "REGULAR",
          },
        });

        await applyStockMovement(tx, {
          organizationId,
          branchId,
          ppeItemId: ppeItem.id,
          tipo: "SAIDA_ENTREGA",
          quantidade: line.quantidade,
          motivo: `Entrega para ${employee.nomeCompleto}`,
          referencia: created.id,
          userId,
        });
      }

      await writeAuditLog(tx, { organizationId, userId, action: "ENTREGA", entityType: "Delivery", entityId: created.id, newData: data });
      await writeAuditLog(tx, { organizationId, userId, action: "SAIDA_ESTOQUE", entityType: "Delivery", entityId: created.id, newData: { itens: data.items.length } });

      return tx.delivery.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { include: { ppeItem: true } }, employee: true, branch: true },
      });
    });

    res.status(201).json(delivery);
  } catch (err) {
    next(err);
  }
});

// ===================== IMPORTAÇÃO DE FICHA DE EPI EM PAPEL =====================
// Lança no sistema uma entrega que já aconteceu, a partir da ficha assinada em
// papel digitalizada. Difere da entrega normal em três pontos, e cada um tem razão:
//
// 1. NÃO movimenta estoque. A saída do almoxarifado aconteceu antes do sistema
//    existir; debitar agora criaria um furo de estoque do tamanho do histórico.
// 2. NÃO exige estoque disponível nem CA válido. A ficha registra o passado: o CA
//    daquele EPI provavelmente já venceu, e recusar por isso impediria importar
//    justamente as fichas mais antigas, que são a maioria.
// 3. NÃO cria confirmação eletrônica. Ninguém digitou o nome: quem assinou,
//    assinou no papel. Inventar uma confirmação eletrônica seria fabricar prova.
//    A prova é o PDF anexado, e a tela precisa dizer isso com clareza.
//
// O que ela faz igual à entrega normal, e é o motivo de valer a pena: grava os
// itens com data de entrega e data prevista de troca. É isso que coloca o EPI em
// "EPIs atuais" do colaborador e faz o alerta de troca funcionar.
const itemDaFichaSchema = z.object({
  ppeItemId: z.string().min(1),
  quantidade: z.coerce.number().int().positive(),
});

const importarFichaSchema = z.object({
  employeeId: z.string().min(1),
  // A ficha traz data sem hora. Guardar meia-noite UTC faria o dia aparecer um a
  // menos em qualquer fuso a oeste de Greenwich — no Amazonas (UTC-4), a ficha de
  // 05/05 sairia impressa como 04/05 no termo de entrega. Ancorar ao meio-dia
  // local elimina a chance de a conversão de fuso cruzar a virada do dia.
  dataFicha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data da ficha no formato AAAA-MM-DD.")
    .transform((texto) => {
      const [ano, mes, dia] = texto.split("-").map(Number);
      return new Date(ano, mes - 1, dia, 12, 0, 0, 0);
    }),
  motivo: z
    .enum(["PRIMEIRA_ENTREGA", "SUBSTITUICAO", "TROCA", "PERDA", "DANIFICACAO", "VENCIMENTO", "ADMISSAO", "OUTRO"])
    .optional(),
  observacoes: z.string().max(2000).optional().nullable(),
  // A requisição é multipart, então os itens chegam como texto JSON.
  items: z.preprocess((valor) => {
    if (typeof valor !== "string") return valor;
    try {
      return JSON.parse(valor);
    } catch {
      // Devolve o texto cru para o zod reclamar do formato, em vez de estourar aqui.
      return valor;
    }
  }, z.array(itemDaFichaSchema).min(1)),
});

deliveriesRouter.post("/importar-ficha", uploadDocument.single("ficha"), async (req, res, next) => {
  const arquivo = req.file;
  let chaveDoArquivo: string | null = null;
  // Se a transação falhar depois de gravar o PDF, remove o arquivo órfão.
  const descartarArquivoGravado = async () => {
    if (chaveDoArquivo) await armazenamento.remover("documents", chaveDoArquivo).catch(() => undefined);
  };

  try {
    const { organizationId, id: userId } = req.user!;
    const data = importarFichaSchema.parse(req.body);

    if (!arquivo) throw badRequest("Anexe a ficha de EPI digitalizada (PDF, JPG ou PNG).");

    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId, ...resolveBranchFilter(req.user!) },
      include: { branch: true },
    });
    if (!employee) throw badRequest("Colaborador inválido.");
    // Ao contrário da entrega normal, colaborador desligado ou afastado é aceito:
    // a ficha dele é histórico, e histórico de EPI não se descarta ao desligar.
    assertBranchAllowed(req.user!, employee.branchId);

    const agora = new Date();
    if (data.dataFicha > agora) {
      throw badRequest("A data da ficha está no futuro. Informe a data que consta no papel assinado.");
    }
    if (data.dataFicha < new Date("1990-01-01")) {
      throw badRequest("A data da ficha é anterior a 1990. Confira o que foi digitado.");
    }

    const ppeItemIds = [...new Set(data.items.map((i) => i.ppeItemId))];
    if (ppeItemIds.length !== data.items.length) {
      throw badRequest("A ficha tem o mesmo EPI repetido em duas linhas. Some as quantidades numa só.");
    }
    const ppeItems = await prisma.ppeItem.findMany({ where: { id: { in: ppeItemIds }, organizationId } });
    if (ppeItems.length !== ppeItemIds.length) throw badRequest("Um ou mais EPIs informados são inválidos.");

    // A matriz Cargo x EPI pode definir vida útil própria para o cargo, e ela
    // prevalece sobre a do catálogo no cálculo da data de troca.
    const requisitosDoCargo = employee.positionId
      ? await prisma.positionPpeRequirement.findMany({
          where: { positionId: employee.positionId, ppeItemId: { in: ppeItemIds } },
          select: { ppeItemId: true, vidaUtilDiasOverride: true },
        })
      : [];
    const vidaUtilPorItem = new Map(
      requisitosDoCargo
        .filter((r) => r.vidaUtilDiasOverride != null)
        .map((r) => [r.ppeItemId, r.vidaUtilDiasOverride as number])
    );

    chaveDoArquivo = nomeUnico(arquivo.mimetype, ".pdf");
    await armazenamento.salvar("documents", chaveDoArquivo, arquivo.buffer, arquivo.mimetype);
    const chaveGravada = chaveDoArquivo;

    const entrega = await prisma.$transaction(async (tx) => {
      const criada = await tx.delivery.create({
        data: {
          organizationId,
          // Melhor informação disponível: a filial atual do colaborador. A ficha de
          // papel é que manda, e ela fica anexada para conferência.
          branchId: employee.branchId,
          employeeId: employee.id,
          motivo: data.motivo ?? "OUTRO",
          observacoes: data.observacoes ?? null,
          origem: "FICHA_IMPORTADA",
          dataFicha: data.dataFicha,
          // Já nasce confirmada: o recebimento aconteceu e está assinado no papel.
          status: "CONFIRMADA",
          createdById: userId,
        },
      });

      // Decide por data quem substitui quem, antes de criar os itens desta ficha.
      const { anterioresSubstituidos, jaSuperados } = await aplicarSubstituicaoPorData(
        tx,
        employee.id,
        criada.id,
        ppeItemIds,
        data.dataFicha
      );

      for (const linha of data.items) {
        const ppeItem = ppeItems.find((p) => p.id === linha.ppeItemId)!;
        const vidaUtil = vidaUtilPorItem.get(ppeItem.id) ?? ppeItem.vidaUtilDias;

        await tx.deliveryItem.create({
          data: {
            deliveryId: criada.id,
            ppeItemId: ppeItem.id,
            caSnapshot: ppeItem.ca,
            quantidade: linha.quantidade,
            // Sem compra no sistema para esta entrega: vale o custo do catálogo.
            custoUnitarioSnapshot: ppeItem.custoUnitario,
            dataEntrega: data.dataFicha,
            dataPrevistaTroca: new Date(data.dataFicha.getTime() + vidaUtil * 24 * 60 * 60 * 1000),
            // Se o colaborador recebeu este mesmo EPI depois desta ficha, o item
            // desta ficha já nasce substituído: senão apareceria como EPI atual.
            status: jaSuperados.has(ppeItem.id) ? "SUBSTITUIDO" : "REGULAR",
          },
        });
      }

      const documento = await tx.document.create({
        data: {
          organizationId,
          deliveryId: criada.id,
          fileName: arquivo.originalname,
          mimeType: arquivo.mimetype,
          sizeBytes: arquivo.size,
          storagePath: chaveGravada,
          uploadedById: userId,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "ENTREGA",
        entityType: "Delivery",
        entityId: criada.id,
        newData: {
          origem: "FICHA_IMPORTADA",
          colaborador: employee.nomeCompleto,
          dataFicha: data.dataFicha.toISOString(),
          itens: data.items.length,
          documentoId: documento.id,
          arquivo: arquivo.originalname,
          itensAnterioresSubstituidos: anterioresSubstituidos,
          // Registrado porque muda o que o colaborador aparenta ter hoje.
          itensDestaFichaJaSubstituidos: data.items.filter((i) => jaSuperados.has(i.ppeItemId)).length,
          // Deixa explícito na auditoria que não houve baixa de estoque.
          movimentouEstoque: false,
        },
      });

      return tx.delivery.findUniqueOrThrow({
        where: { id: criada.id },
        include: { items: { include: { ppeItem: true } }, employee: true, branch: true, documents: true },
      });
    });

    res.status(201).json(entrega);
  } catch (err) {
    await descartarArquivoGravado();
    next(err);
  }
});

// Ficha de papel digitalizada de uma entrega importada. Servida só para usuário
// autenticado da própria organização (e da própria filial, quando restrito).
deliveriesRouter.get("/:id/ficha", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: { documents: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!delivery) throw notFound("Entrega não encontrada.");

    const documento = delivery.documents[0];
    if (!documento) throw notFound("Esta entrega não possui ficha digitalizada anexada.");

    const conteudo = await armazenamento.ler("documents", documento.storagePath);
    if (!conteudo) throw notFound("Arquivo da ficha não encontrado no armazenamento.");

    res.setHeader("Content-Type", documento.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(documento.fileName)}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(conteudo);
  } catch (err) {
    next(err);
  }
});

// Cancela uma entrega e devolve os itens ao estoque da filial.
// - PENDENTE: cancelamento simples, feito por quem opera entregas.
// - CONFIRMADA: é um estorno. Exige perfil ADMIN e justificativa escrita, porque
//   desfaz um recebimento que o colaborador já confirmou eletronicamente.
//   A confirmação original é preservada como evidência; só o status da entrega muda.
const cancelSchema = z.object({
  motivo: z.string().trim().min(5).optional(),
});

deliveriesRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const { organizationId, id: userId, role } = req.user!;
    const data = cancelSchema.parse(req.body ?? {});

    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: { items: { include: { ppeItem: true } }, confirmation: true, employee: true },
    });
    if (!delivery) throw notFound("Entrega não encontrada.");

    // Ficha de papel importada não baixou estoque na entrega, então cancelar não
    // pode devolver nada: devolveria ao almoxarifado um item que nunca saiu dele,
    // inflando o saldo. Por isso ela também não exige filial definida.
    const devolveEstoque = delivery.origem !== "FICHA_IMPORTADA";
    if (devolveEstoque && !delivery.branchId) throw badRequest("Entrega sem filial definida.");

    if (delivery.status === "CANCELADA") throw conflict("Esta entrega já está cancelada.");
    if (delivery.status !== "PENDENTE" && delivery.status !== "CONFIRMADA") {
      throw badRequest("Esta entrega não pode ser cancelada.");
    }

    const estorno = delivery.status === "CONFIRMADA";
    if (estorno) {
      // Cancelar uma entrega já confirmada desfaz o efeito de um documento
      // assinado pelo colaborador. Fica com quem responde pelo processo —
      // administrador e RH — e não com o gerente da filial.
      if (role !== "ADMIN" && role !== "RH") {
        throw forbidden("Apenas administrador ou RH podem cancelar uma entrega já confirmada pelo colaborador.");
      }
      if (!data.motivo) {
        throw badRequest("Informe a justificativa do cancelamento (mínimo de 5 caracteres).");
      }
    }

    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      if (devolveEstoque) {
        for (const item of delivery.items) {
          await applyStockMovement(tx, {
            organizationId,
            branchId: delivery.branchId!,
            ppeItemId: item.ppeItemId,
            tipo: "AJUSTE_POSITIVO",
            quantidade: item.quantidade,
            motivo: estorno
              ? `Estorno da entrega confirmada de ${delivery.employee.nomeCompleto}: ${data.motivo}`
              : `Cancelamento da entrega ${delivery.id}`,
            referencia: delivery.id,
            userId,
          });
        }
      }

      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "CANCELADA",
          cancelamentoMotivo: data.motivo ?? null,
          canceladoEm: agora,
          canceladoPorId: userId,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "ALTERACAO",
        entityType: "Delivery",
        entityId: delivery.id,
        oldData: {
          status: delivery.status,
          confirmacaoId: delivery.confirmation?.id ?? null,
          confirmadoPor: delivery.confirmation?.nomeDigitado ?? null,
          confirmadoEm: delivery.confirmation?.confirmedAt ?? null,
        },
        newData: {
          status: "CANCELADA",
          estornoDeEntregaConfirmada: estorno,
          justificativa: data.motivo ?? null,
          origem: delivery.origem,
          // Zero nas fichas importadas: elas nunca baixaram estoque.
          itensDevolvidosAoEstoque: devolveEstoque ? delivery.items.length : 0,
        },
      });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ===================== EXCLUSÃO DEFINITIVA =====================
//
// Cancelar preserva a entrega como CANCELADA, com justificativa e auditoria, e é
// o caminho normal. Excluir apaga a linha: a entrega some do histórico do
// colaborador e levam junto a confirmação eletrônica, a foto do recebimento e a
// ficha de papel digitalizada. Numa entrega confirmada isso apaga a prova de que
// o EPI foi entregue, por isso só administrador e RH chegam aqui e a tela avisa
// antes de apagar.
//
// O estoque volta pelos mesmos critérios do cancelamento: a entrega baixou
// estoque ao nascer, então apagá-la sem devolver deixaria o saldo menor do que a
// prateleira. Entrega já cancelada não devolve de novo, porque o cancelamento já
// devolveu, e ficha importada nunca baixou nada.
deliveriesRouter.delete("/:id", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;

    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        items: { include: { ppeItem: true, _count: { select: { ppeReturns: true, charges: true } } } },
        confirmation: true,
        documents: true,
        employee: true,
      },
    });
    if (!delivery) throw notFound("Entrega não encontrada.");

    // Devolução e cobrança são registros de outra natureza que apontam para o
    // item desta entrega. Apagar a entrega deixaria os dois órfãos — uma cobrança
    // sem a entrega que a originou não se explica sozinha. Melhor recusar e dizer
    // o que precisa ser resolvido primeiro.
    const devolucoes = delivery.items.reduce((total, item) => total + item._count.ppeReturns, 0);
    const cobrancas = delivery.items.reduce((total, item) => total + item._count.charges, 0);
    if (devolucoes > 0 || cobrancas > 0) {
      const ligados = [
        devolucoes > 0 ? `${devolucoes} devolução(ões)` : null,
        cobrancas > 0 ? `${cobrancas} cobrança(s)` : null,
      ]
        .filter(Boolean)
        .join(" e ");
      throw conflict(
        `Esta entrega tem ${ligados} ligada(s) a ela e não pode ser excluída: ` +
          `esses registros ficariam sem a entrega que os originou. Resolva-os antes, ou cancele a entrega.`
      );
    }

    const devolveEstoque = delivery.origem !== "FICHA_IMPORTADA" && delivery.status !== "CANCELADA";
    if (devolveEstoque && !delivery.branchId) throw badRequest("Entrega sem filial definida.");

    await prisma.$transaction(async (tx) => {
      if (devolveEstoque) {
        for (const item of delivery.items) {
          await applyStockMovement(tx, {
            organizationId,
            branchId: delivery.branchId!,
            ppeItemId: item.ppeItemId,
            tipo: "AJUSTE_POSITIVO",
            quantidade: item.quantidade,
            motivo: `Exclusão da entrega de ${delivery.employee.nomeCompleto}`,
            referencia: delivery.id,
            userId,
          });
        }
      }

      if (delivery.confirmation) {
        await tx.electronicConfirmation.delete({ where: { id: delivery.confirmation.id } });
      }
      if (delivery.documents.length > 0) {
        await tx.document.deleteMany({ where: { deliveryId: delivery.id } });
      }
      // Os itens caem junto por cascade, declarado no schema.
      await tx.delivery.delete({ where: { id: delivery.id } });

      // A auditoria fica com o retrato do que foi apagado: depois daqui é o
      // único lugar onde esta entrega ainda existe.
      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "ALTERACAO",
        entityType: "Delivery",
        entityId: delivery.id,
        oldData: {
          status: delivery.status,
          origem: delivery.origem,
          motivo: delivery.motivo,
          colaborador: delivery.employee.nomeCompleto,
          cpf: delivery.employee.cpf,
          dataFicha: delivery.dataFicha,
          criadaEm: delivery.createdAt,
          itens: delivery.items.map((item) => ({
            epi: item.ppeItem.nome,
            codigo: item.ppeItem.codigoInterno,
            quantidade: item.quantidade,
            dataEntrega: item.dataEntrega,
          })),
          confirmadoPor: delivery.confirmation?.nomeDigitado ?? null,
          confirmadoEm: delivery.confirmation?.confirmedAt ?? null,
          fichasAnexadas: delivery.documents.map((doc) => doc.fileName),
        },
        newData: {
          excluida: true,
          itensDevolvidosAoEstoque: devolveEstoque ? delivery.items.length : 0,
        },
      });
    });

    // Fora da transação, porque arquivo não tem rollback. Falhando aqui sobra um
    // arquivo órfão no armazenamento, o que é melhor do que uma entrega que
    // ressuscita depois de já ter sido apagada do banco.
    if (delivery.confirmation?.photoPath) {
      await armazenamento.remover("confirmations", delivery.confirmation.photoPath).catch(() => undefined);
    }
    for (const documento of delivery.documents) {
      await armazenamento.remover("documents", documento.storagePath).catch(() => undefined);
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ===================== TERMO DE ENTREGA (PDF) =====================
deliveriesRouter.get("/:id/termo.pdf", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        employee: { include: { position: true, department: true, branch: true, contractBranch: true } },
        branch: true,
        items: { include: { ppeItem: true } },
        confirmation: true,
        createdBy: { select: { name: true } },
      },
    });
    if (!delivery) throw notFound("Entrega não encontrada.");

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const logoFilename = organization.logoUrl?.split("/").pop();
    const [logo, photo] = await Promise.all([
      logoFilename ? armazenamento.ler("logos", decodeURIComponent(logoFilename)) : Promise.resolve(null),
      delivery.confirmation?.photoPath
        ? armazenamento.ler("confirmations", delivery.confirmation.photoPath)
        : Promise.resolve(null),
    ]);

    generateDeliveryTermPdf(res, {
      organization: {
        razaoSocial: organization.razaoSocial,
        cnpj: organization.cnpj,
        endereco: organization.endereco,
        logo,
      },
      employee: {
        nomeCompleto: delivery.employee.nomeCompleto,
        cpf: delivery.employee.cpf,
        matricula: delivery.employee.matricula,
        cargo: delivery.employee.position?.nome,
        setor: delivery.employee.department?.nome,
        filial: delivery.branch?.nome ?? delivery.employee.branch?.nome,
        filialContrato: delivery.employee.contractBranch?.nome ?? null,
        cnpjContrato: delivery.employee.contractBranch?.cnpj ?? null,
      },
      delivery: {
        id: delivery.id,
        createdAt: delivery.createdAt,
        motivo: delivery.motivo,
        responsavel: delivery.createdBy.name,
        cancelada: delivery.status === "CANCELADA",
        cancelamentoMotivo: delivery.cancelamentoMotivo,
        canceladoEm: delivery.canceladoEm,
        fichaImportada: delivery.origem === "FICHA_IMPORTADA",
        dataFicha: delivery.dataFicha,
      },
      items: delivery.items.map((i) => ({ nome: i.ppeItem.nome, ca: i.caSnapshot, quantidade: i.quantidade, dataPrevistaTroca: i.dataPrevistaTroca })),
      confirmation: delivery.confirmation
        ? {
            nomeDigitado: delivery.confirmation.nomeDigitado,
            confirmedAt: delivery.confirmation.confirmedAt,
            id: delivery.confirmation.id,
            photo,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// ===================== CONFIRMAÇÃO ELETRÔNICA DE RECEBIMENTO =====================
// Aceita multipart/form-data com o campo opcional "photo" (captura da câmera)
// além dos campos de texto nomeDigitado e concordo.
const confirmSchema = z.object({
  nomeDigitado: z.string().min(2),
  concordo: z.union([z.literal(true), z.literal("true")]),
});

deliveriesRouter.post("/:id/confirm", uploadConfirmationPhoto.single("photo"), async (req, res, next) => {
  // A foto chega em memória e só é gravada quando a confirmação passa por todas as
  // validações: requisição recusada não deixa arquivo para trás.
  const uploadedFile = req.file;
  let chaveDaFoto: string | null = null;
  // Se a transação falhar depois de gravar a foto, remove o arquivo órfão.
  const descartarFotoGravada = async () => {
    if (chaveDaFoto) await armazenamento.remover("confirmations", chaveDaFoto).catch(() => undefined);
  };

  try {
    const { organizationId, id: userId } = req.user!;
    const data = confirmSchema.parse(req.body);

    const [delivery, organization] = await Promise.all([
      prisma.delivery.findFirst({
        where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
        include: { employee: true, confirmation: true, items: true },
      }),
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    ]);

    if (!delivery) throw notFound("Entrega não encontrada.");
    if (delivery.status === "CONFIRMADA") throw conflict("Esta entrega já foi confirmada.");
    if (delivery.status !== "PENDENTE") throw badRequest("Esta entrega não pode mais ser confirmada.");

    if (!namesMatch(data.nomeDigitado, delivery.employee.nomeCompleto)) {
      throw forbidden("O nome digitado não corresponde ao nome cadastrado do colaborador.");
    }

    if (organization.exigirFotoConfirmacao && !uploadedFile) {
      throw badRequest("Esta empresa exige a foto do colaborador na confirmação de recebimento.");
    }

    // Uma imagem corrompida não pode ser gravada: ela quebraria o termo de entrega depois.
    if (uploadedFile && !imagemBufferSeguraParaPdf(uploadedFile.buffer)) {
      throw badRequest("A foto enviada está corrompida ou em formato não suportado. Capture a foto novamente (JPG ou PNG).");
    }

    if (uploadedFile) {
      chaveDaFoto = nomeUnico(uploadedFile.mimetype);
      await armazenamento.salvar("confirmations", chaveDaFoto, uploadedFile.buffer, uploadedFile.mimetype);
    }

    const result = await prisma.$transaction(async (tx) => {
      const confirmation = await tx.electronicConfirmation.create({
        data: {
          organizationId,
          deliveryId: delivery.id,
          employeeId: delivery.employeeId,
          nomeDigitado: data.nomeDigitado,
          nomeCadastradoSnapshot: delivery.employee.nomeCompleto,
          method: "CONFIRMACAO_ELETRONICA_DIGITACAO",
          photoPath: chaveDaFoto,
          photoMimeType: uploadedFile?.mimetype ?? null,
          handledById: userId,
        },
      });
      const updated = await tx.delivery.update({
        where: { id: delivery.id },
        data: { status: "CONFIRMADA" },
        include: { items: { include: { ppeItem: true } }, employee: true, confirmation: true },
      });

      // Ao confirmar, os EPIs iguais que o colaborador já tinha passam a ser os
      // substituídos — senão o item antigo continuaria contando como ativo e
      // gerando alerta de vencimento depois de já ter sido trocado.
      const substituidos = await marcarEntregasAnterioresComoSubstituidas(
        tx,
        delivery.employeeId,
        delivery.id,
        delivery.items.map((i) => i.ppeItemId)
      );

      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "CONFIRMACAO",
        entityType: "ElectronicConfirmation",
        entityId: confirmation.id,
        newData: {
          deliveryId: delivery.id,
          nomeDigitado: data.nomeDigitado,
          comFoto: !!uploadedFile,
          itensSubstituidos: substituidos,
        },
      });
      return updated;
    });

    res.json(result);
  } catch (err) {
    await descartarFotoGravada();
    next(err);
  }
});

// Foto da confirmação — servida apenas para usuários autenticados da própria
// organização (e da própria filial, quando o usuário é restrito).
deliveriesRouter.get("/:id/confirmation-photo", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: { confirmation: true },
    });
    if (!delivery?.confirmation?.photoPath) throw notFound("Esta entrega não possui foto de confirmação.");

    const conteudo = await armazenamento.ler("confirmations", delivery.confirmation.photoPath);
    if (!conteudo) throw notFound("Arquivo de foto não encontrado.");

    res.setHeader("Content-Type", delivery.confirmation.photoMimeType ?? "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(conteudo);
  } catch (err) {
    next(err);
  }
});
