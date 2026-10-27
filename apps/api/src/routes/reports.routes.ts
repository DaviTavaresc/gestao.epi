import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { sendExcel } from "../utils/excel";
import { exportListPdf } from "../utils/pdf";
import { computeCaStatus, computeLifecycleStatus } from "../utils/ppeStatus";
import { badRequest } from "../utils/httpError";
import { resolveBranchFilter } from "../utils/branchScope";

export const reportsRouter = Router();
// Relatórios são somente leitura — todo perfil autenticado pode visualizar, incluindo CONSULTA.
reportsRouter.use(requireAuth);

type Row = Record<string, unknown>;

async function getThresholds(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  return { proximo: org!.alertDaysProximo, atencao: org!.alertDaysAtencao, critico: org!.alertDaysCritico };
}

function parseDateRange(req: { query: Record<string, unknown> }) {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  return { from, to };
}

async function buildReport(
  type: string,
  organizationId: string,
  query: Record<string, unknown>,
  branchId?: string
): Promise<{ title: string; columns: { header: string; key: string; width: number }[]; rows: Row[] }> {
  const { from, to } = parseDateRange({ query });
  const employeeId = query.employeeId as string | undefined;
  const ppeItemId = query.ppeItemId as string | undefined;
  const departmentId = query.departmentId as string | undefined;
  const positionId = query.positionId as string | undefined;
  // Escopo de filial aplicado conforme o acesso do usuário.
  const branchWhere = branchId ? { branchId } : {};
  const employeeBranchWhere = branchId ? { employee: { branchId } } : {};

  switch (type) {
    case "entregas": {
      const deliveries = await prisma.delivery.findMany({
        where: {
          organizationId,
          ...branchWhere,
          ...(employeeId ? { employeeId } : {}),
          ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          ...(departmentId ? { employee: { departmentId } } : {}),
          ...(positionId ? { employee: { positionId } } : {}),
        },
        include: {
          employee: { include: { position: true, department: true } },
          branch: true,
          items: { include: { ppeItem: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      const rows: Row[] = deliveries.flatMap((d) =>
        d.items.map((i) => ({
          data: `${d.createdAt.toLocaleDateString("pt-BR")} ${d.createdAt.toLocaleTimeString("pt-BR")}`,
          filial: d.branch?.nome ?? "-",
          colaborador: d.employee.nomeCompleto,
          cargo: d.employee.position?.nome ?? "-",
          setor: d.employee.department?.nome ?? "-",
          epi: i.ppeItem.nome,
          ca: i.caSnapshot,
          quantidade: i.quantidade,
          motivo: d.motivo,
          status: d.status,
        }))
      );
      return {
        title: "Relatório de Entregas",
        columns: [
          { header: "Data/hora", key: "data", width: 110 },
          { header: "Filial", key: "filial", width: 110 },
          { header: "Colaborador", key: "colaborador", width: 160 },
          { header: "Cargo", key: "cargo", width: 120 },
          { header: "Setor", key: "setor", width: 120 },
          { header: "EPI", key: "epi", width: 160 },
          { header: "CA", key: "ca", width: 70 },
          { header: "Qtd", key: "quantidade", width: 50 },
          { header: "Motivo", key: "motivo", width: 120 },
          { header: "Status", key: "status", width: 100 },
        ],
        rows,
      };
    }
    case "colaboradores": {
      const employees = await prisma.employee.findMany({
        where: {
          organizationId,
          ...branchWhere,
          ...(departmentId ? { departmentId } : {}),
          ...(positionId ? { positionId } : {}),
        },
        include: { position: true, department: true, branch: true },
        orderBy: { nomeCompleto: "asc" },
      });
      const rows: Row[] = employees.map((e) => ({
        nome: e.nomeCompleto,
        filial: e.branch?.nome ?? "-",
        cpf: e.cpf,
        matricula: e.matricula,
        cargo: e.position?.nome ?? "-",
        setor: e.department?.nome ?? "-",
        admissao: e.dataAdmissao.toLocaleDateString("pt-BR"),
        status: e.status,
      }));
      return {
        title: "Relatório de Colaboradores",
        columns: [
          { header: "Nome", key: "nome", width: 200 },
          { header: "Filial", key: "filial", width: 110 },
          { header: "CPF", key: "cpf", width: 110 },
          { header: "Matrícula", key: "matricula", width: 90 },
          { header: "Cargo", key: "cargo", width: 140 },
          { header: "Setor", key: "setor", width: 140 },
          { header: "Admissão", key: "admissao", width: 100 },
          { header: "Status", key: "status", width: 90 },
        ],
        rows,
      };
    }
    case "estoque": {
      const stocks = await prisma.branchStock.findMany({
        where: { organizationId, ...branchWhere },
        include: { ppeItem: { include: { category: true } }, branch: true },
        orderBy: [{ branch: { nome: "asc" } }, { ppeItem: { nome: "asc" } }],
      });
      const rows: Row[] = stocks.map((s) => ({
        filial: s.branch.nome,
        epi: s.ppeItem.nome,
        codigo: s.ppeItem.codigoInterno,
        categoria: s.ppeItem.category.nome,
        estoqueAtual: s.estoqueAtual,
        estoqueMinimo: s.estoqueMinimo,
        estoqueMaximo: s.estoqueMaximo,
        custoUnitario: Number(s.custoUnitario),
        valorEmEstoque: Number(s.custoUnitario) * s.estoqueAtual,
        status: s.ppeItem.status,
      }));
      return {
        title: "Relatório de Estoque por Filial",
        columns: [
          { header: "Filial", key: "filial", width: 120 },
          { header: "EPI", key: "epi", width: 170 },
          { header: "Código", key: "codigo", width: 90 },
          { header: "Categoria", key: "categoria", width: 130 },
          { header: "Estoque atual", key: "estoqueAtual", width: 90 },
          { header: "Mínimo", key: "estoqueMinimo", width: 70 },
          { header: "Máximo", key: "estoqueMaximo", width: 70 },
          { header: "Custo unit.", key: "custoUnitario", width: 80 },
          { header: "Valor em estoque", key: "valorEmEstoque", width: 100 },
          { header: "Status", key: "status", width: 70 },
        ],
        rows,
      };
    }
    case "movimentacoes": {
      const movements = await prisma.stockMovement.findMany({
        where: {
          organizationId,
          ...branchWhere,
          ...(ppeItemId ? { ppeItemId } : {}),
          ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        include: { ppeItem: true, user: true, branch: true },
        orderBy: { createdAt: "desc" },
      });
      const rows: Row[] = movements.map((m) => ({
        data: m.createdAt.toLocaleString("pt-BR"),
        filial: m.branch.nome,
        epi: m.ppeItem.nome,
        tipo: m.tipo,
        quantidade: m.quantidade,
        estoqueAnterior: m.estoqueAnterior,
        estoquePosterior: m.estoquePosterior,
        usuario: m.user.name,
        motivo: m.motivo ?? "-",
      }));
      return {
        title: "Relatório de Movimentações de Estoque",
        columns: [
          { header: "Data", key: "data", width: 110 },
          { header: "Filial", key: "filial", width: 100 },
          { header: "EPI", key: "epi", width: 150 },
          { header: "Tipo", key: "tipo", width: 120 },
          { header: "Qtd", key: "quantidade", width: 50 },
          { header: "Estoque anterior", key: "estoqueAnterior", width: 100 },
          { header: "Estoque posterior", key: "estoquePosterior", width: 100 },
          { header: "Usuário", key: "usuario", width: 120 },
          { header: "Motivo", key: "motivo", width: 180 },
        ],
        rows,
      };
    }
    case "epis-vencidos":
    case "epis-proximos-troca": {
      const thresholds = await getThresholds(organizationId);
      const now = new Date();
      const deliveries = await prisma.delivery.findMany({
        where: { organizationId, status: "CONFIRMADA", ...branchWhere },
        include: { employee: { include: { department: true, branch: true } }, items: { include: { ppeItem: true } } },
      });
      const returns = await prisma.ppeReturn.findMany({ where: { organizationId } });
      const returnedIds = new Set(returns.map((r) => r.deliveryItemId).filter(Boolean));
      const rows: Row[] = [];
      for (const d of deliveries) {
        for (const item of d.items) {
          if (returnedIds.has(item.id) || item.status === "SUBSTITUIDO") continue;
          const status = computeLifecycleStatus(item.dataPrevistaTroca, now, thresholds);
          const wanted = type === "epis-vencidos" ? status === "VENCIDO" : status === "PROXIMO_DA_TROCA" || status === "CRITICO";
          if (!wanted) continue;
          rows.push({
            colaborador: d.employee.nomeCompleto,
            filial: d.employee.branch?.nome ?? "-",
            setor: d.employee.department?.nome ?? "-",
            epi: item.ppeItem.nome,
            dataEntrega: item.dataEntrega.toLocaleDateString("pt-BR"),
            dataPrevistaTroca: item.dataPrevistaTroca.toLocaleDateString("pt-BR"),
            status,
          });
        }
      }
      return {
        title: type === "epis-vencidos" ? "EPIs Vencidos" : "EPIs Próximos da Troca",
        columns: [
          { header: "Colaborador", key: "colaborador", width: 170 },
          { header: "Filial", key: "filial", width: 110 },
          { header: "Setor", key: "setor", width: 130 },
          { header: "EPI", key: "epi", width: 180 },
          { header: "Data entrega", key: "dataEntrega", width: 100 },
          { header: "Troca prevista", key: "dataPrevistaTroca", width: 110 },
          { header: "Status", key: "status", width: 100 },
        ],
        rows,
      };
    }
    case "ca-vencidos":
    case "ca-proximos-vencimento": {
      const thresholds = await getThresholds(organizationId);
      const now = new Date();
      const items = await prisma.ppeItem.findMany({ where: { organizationId, status: "ATIVO" }, include: { category: true } });
      const rows: Row[] = items
        .map((i) => ({ i, status: computeCaStatus(i.caValidade, now, thresholds) }))
        .filter(({ status }) => (type === "ca-vencidos" ? status === "VENCIDO" : status === "PROXIMO_VENCIMENTO"))
        // O filtro acima só deixa passar itens com CA, então ca e caValidade existem.
        .map(({ i }) => ({
          epi: i.nome,
          categoria: i.category.nome,
          ca: i.ca!,
          validade: i.caValidade!.toLocaleDateString("pt-BR"),
        }));
      return {
        title: type === "ca-vencidos" ? "CAs Vencidos" : "CAs Próximos do Vencimento",
        columns: [
          { header: "EPI", key: "epi", width: 200 },
          { header: "Categoria", key: "categoria", width: 160 },
          { header: "CA", key: "ca", width: 100 },
          { header: "Validade", key: "validade", width: 100 },
        ],
        rows,
      };
    }
    case "compras": {
      const purchases = await prisma.purchase.findMany({
        where: {
          organizationId,
          ...branchWhere,
          ...(from || to ? { dataCompra: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        include: { supplier: true, branch: true },
        orderBy: { dataCompra: "desc" },
      });
      const rows: Row[] = purchases.map((p) => ({
        nf: p.numeroNf,
        filial: p.branch.nome,
        fornecedor: p.supplier.razaoSocial,
        data: p.dataCompra.toLocaleDateString("pt-BR"),
        valorTotal: Number(p.valorTotal),
        status: p.status,
      }));
      return {
        title: "Relatório de Compras",
        columns: [
          { header: "NF", key: "nf", width: 90 },
          { header: "Filial", key: "filial", width: 110 },
          { header: "Fornecedor", key: "fornecedor", width: 180 },
          { header: "Data", key: "data", width: 100 },
          { header: "Valor total", key: "valorTotal", width: 100 },
          { header: "Status", key: "status", width: 100 },
        ],
        rows,
      };
    }
    case "devolucoes": {
      const returns = await prisma.ppeReturn.findMany({
        where: {
          organizationId,
          ...employeeBranchWhere,
          ...(employeeId ? { employeeId } : {}),
          ...(from || to ? { dataDevolucao: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        include: { employee: { include: { branch: true } }, ppeItem: true },
        orderBy: { dataDevolucao: "desc" },
      });
      const rows: Row[] = returns.map((r) => ({
        data: r.dataDevolucao.toLocaleDateString("pt-BR"),
        filial: r.employee.branch?.nome ?? "-",
        colaborador: r.employee.nomeCompleto,
        epi: r.ppeItem.nome,
        quantidade: r.quantidade,
        motivo: r.motivo,
        estado: r.estado,
        retornouEstoque: r.retornouEstoque ? "Sim" : "Não",
      }));
      return {
        title: "Relatório de Devoluções",
        columns: [
          { header: "Data", key: "data", width: 90 },
          { header: "Filial", key: "filial", width: 110 },
          { header: "Colaborador", key: "colaborador", width: 160 },
          { header: "EPI", key: "epi", width: 160 },
          { header: "Qtd", key: "quantidade", width: 50 },
          { header: "Motivo", key: "motivo", width: 120 },
          { header: "Estado", key: "estado", width: 100 },
          { header: "Retornou ao estoque", key: "retornouEstoque", width: 100 },
        ],
        rows,
      };
    }
    case "epis-por-colaborador": {
      const deliveries = await prisma.delivery.findMany({
        where: { organizationId, status: "CONFIRMADA", ...branchWhere, ...(employeeId ? { employeeId } : {}) },
        include: { employee: { include: { branch: true } }, items: { include: { ppeItem: true } } },
        orderBy: { createdAt: "desc" },
      });
      const rows: Row[] = deliveries.flatMap((d) =>
        d.items.map((i) => ({
          colaborador: d.employee.nomeCompleto,
          filial: d.employee.branch?.nome ?? "-",
          matricula: d.employee.matricula,
          epi: i.ppeItem.nome,
          ca: i.caSnapshot,
          quantidade: i.quantidade,
          dataEntrega: i.dataEntrega.toLocaleDateString("pt-BR"),
          dataPrevistaTroca: i.dataPrevistaTroca.toLocaleDateString("pt-BR"),
        }))
      );
      return {
        title: "EPIs por Colaborador",
        columns: [
          { header: "Colaborador", key: "colaborador", width: 165 },
          { header: "Filial", key: "filial", width: 105 },
          { header: "Matrícula", key: "matricula", width: 80 },
          { header: "EPI", key: "epi", width: 160 },
          { header: "CA", key: "ca", width: 70 },
          { header: "Qtd", key: "quantidade", width: 50 },
          { header: "Entrega", key: "dataEntrega", width: 90 },
          { header: "Troca prevista", key: "dataPrevistaTroca", width: 100 },
        ],
        rows,
      };
    }
    case "epis-por-setor": {
      const deliveries = await prisma.delivery.findMany({
        where: { organizationId, status: "CONFIRMADA", ...branchWhere, ...(departmentId ? { employee: { departmentId } } : {}) },
        include: { employee: { include: { department: true } }, items: { include: { ppeItem: true } } },
      });
      const bySetor = new Map<string, { epi: string; quantidade: number }[]>();
      for (const d of deliveries) {
        const setor = d.employee.department?.nome ?? "Sem setor";
        const list = bySetor.get(setor) ?? [];
        for (const item of d.items) list.push({ epi: item.ppeItem.nome, quantidade: item.quantidade });
        bySetor.set(setor, list);
      }
      const rows: Row[] = [];
      for (const [setor, items] of bySetor.entries()) {
        const totals = new Map<string, number>();
        for (const item of items) totals.set(item.epi, (totals.get(item.epi) ?? 0) + item.quantidade);
        for (const [epi, quantidade] of totals.entries()) rows.push({ setor, epi, quantidade });
      }
      return {
        title: "EPIs por Setor",
        columns: [
          { header: "Setor", key: "setor", width: 160 },
          { header: "EPI", key: "epi", width: 200 },
          { header: "Quantidade total", key: "quantidade", width: 100 },
        ],
        rows,
      };
    }
    case "custos": {
      const deliveries = await prisma.delivery.findMany({
        where: {
          organizationId,
          status: "CONFIRMADA",
          ...branchWhere,
          ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          ...(departmentId ? { employee: { departmentId } } : {}),
        },
        include: { employee: { include: { department: true } }, branch: true, items: { include: { ppeItem: true } } },
      });
      const rows: Row[] = deliveries.flatMap((d) =>
        d.items.map((i) => ({
          data: d.createdAt.toLocaleDateString("pt-BR"),
          filial: d.branch?.nome ?? "-",
          colaborador: d.employee.nomeCompleto,
          setor: d.employee.department?.nome ?? "-",
          epi: i.ppeItem.nome,
          quantidade: i.quantidade,
          custoUnitario: Number(i.custoUnitarioSnapshot),
          custoTotal: Number(i.custoUnitarioSnapshot) * i.quantidade,
        }))
      );
      return {
        title: "Relatório de Custos",
        columns: [
          { header: "Data", key: "data", width: 90 },
          { header: "Filial", key: "filial", width: 105 },
          { header: "Colaborador", key: "colaborador", width: 150 },
          { header: "Setor", key: "setor", width: 110 },
          { header: "EPI", key: "epi", width: 160 },
          { header: "Qtd", key: "quantidade", width: 50 },
          { header: "Custo unit.", key: "custoUnitario", width: 90 },
          { header: "Custo total", key: "custoTotal", width: 90 },
        ],
        rows,
      };
    }
    case "fornecedores": {
      const suppliers = await prisma.supplier.findMany({ where: { organizationId }, orderBy: { razaoSocial: "asc" } });
      const rows: Row[] = suppliers.map((s) => ({
        razaoSocial: s.razaoSocial,
        nomeFantasia: s.nomeFantasia ?? "-",
        cnpj: s.cnpj,
        telefone: s.telefone ?? "-",
        email: s.email ?? "-",
        status: s.status,
      }));
      return {
        title: "Relatório de Fornecedores",
        columns: [
          { header: "Razão social", key: "razaoSocial", width: 200 },
          { header: "Nome fantasia", key: "nomeFantasia", width: 160 },
          { header: "CNPJ", key: "cnpj", width: 110 },
          { header: "Telefone", key: "telefone", width: 100 },
          { header: "E-mail", key: "email", width: 160 },
          { header: "Status", key: "status", width: 80 },
        ],
        rows,
      };
    }
    case "cargos": {
      const positions = await prisma.position.findMany({
        where: { organizationId },
        orderBy: { nome: "asc" },
        include: { _count: { select: { employees: true, requirements: true } } },
      });
      const rows: Row[] = positions.map((p) => ({
        nome: p.nome,
        descricao: p.descricao ?? "-",
        colaboradores: p._count.employees,
        episObrigatorios: p._count.requirements,
        status: p.status,
      }));
      return {
        title: "Relatório de Cargos",
        columns: [
          { header: "Nome", key: "nome", width: 180 },
          { header: "Descrição", key: "descricao", width: 220 },
          { header: "Colaboradores", key: "colaboradores", width: 100 },
          { header: "EPIs obrigatórios", key: "episObrigatorios", width: 110 },
          { header: "Status", key: "status", width: 80 },
        ],
        rows,
      };
    }
    case "setores": {
      const departments = await prisma.department.findMany({
        where: { organizationId },
        orderBy: { nome: "asc" },
        include: { _count: { select: { employees: true } } },
      });
      const rows: Row[] = departments.map((d) => ({
        nome: d.nome,
        responsavel: d.responsavel ?? "-",
        colaboradores: d._count.employees,
        status: d.status,
      }));
      return {
        title: "Relatório de Setores",
        columns: [
          { header: "Nome", key: "nome", width: 180 },
          { header: "Responsável", key: "responsavel", width: 160 },
          { header: "Colaboradores", key: "colaboradores", width: 100 },
          { header: "Status", key: "status", width: 80 },
        ],
        rows,
      };
    }
    case "alertas": {
      const alerts = await prisma.alert.findMany({
        where: { organizationId },
        orderBy: [{ status: "asc" }, { prioridade: "asc" }, { createdAt: "desc" }],
        take: 1000,
      });
      const rows: Row[] = alerts.map((a) => ({
        data: a.createdAt.toLocaleString("pt-BR"),
        prioridade: a.prioridade,
        titulo: a.titulo,
        mensagem: a.mensagem,
        status: a.status,
      }));
      return {
        title: "Relatório de Alertas",
        columns: [
          { header: "Data", key: "data", width: 130 },
          { header: "Prioridade", key: "prioridade", width: 90 },
          { header: "Título", key: "titulo", width: 180 },
          { header: "Mensagem", key: "mensagem", width: 260 },
          { header: "Status", key: "status", width: 90 },
        ],
        rows,
      };
    }
    default:
      throw badRequest("Tipo de relatório inválido.");
  }
}

reportsRouter.get("/:type", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const format = (req.query.format as string | undefined) ?? "json";
    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);
    const report = await buildReport(
      req.params.type,
      organizationId,
      req.query as Record<string, unknown>,
      branchScope.branchId
    );

    if (format === "xlsx") {
      return sendExcel(res, req.params.type, report.columns.map((c) => ({ header: c.header, key: c.key, width: c.width / 6 })), report.rows as Record<string, unknown>[]);
    }
    if (format === "pdf") {
      const rows = report.rows.map((row) => report.columns.map((c) => String(row[c.key] ?? "")));
      return exportListPdf(res, req.params.type, report.title, report.columns, rows);
    }

    res.json(report);
  } catch (err) {
    next(err);
  }
});
