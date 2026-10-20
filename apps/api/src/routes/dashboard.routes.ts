import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { refreshAlerts } from "../utils/alertsEngine";
import { computeCaStatus, computeLifecycleStatus } from "../utils/ppeStatus";
import { resolveBranchFilter } from "../utils/branchScope";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    await refreshAlerts(organizationId);

    // Escopo de filial: usuário restrito vê apenas a própria; corporativo pode filtrar.
    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);
    const employeeBranchWhere = branchScope.branchId ? { branchId: branchScope.branchId } : {};
    const alertBranchWhere = branchScope.branchId
      ? { OR: [{ branchId: branchScope.branchId }, { branchId: null }] }
      : {};

    const now = new Date();
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    const thresholds = { proximo: org!.alertDaysProximo, atencao: org!.alertDaysAtencao, critico: org!.alertDaysCritico };

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [colaboradoresAtivos, episCadastrados, entregasNoMes, ppeItems, branchStocks] = await Promise.all([
      prisma.employee.count({ where: { organizationId, status: "ATIVO", ...employeeBranchWhere } }),
      prisma.ppeItem.count({ where: { organizationId, status: "ATIVO" } }),
      prisma.delivery.count({ where: { organizationId, status: "CONFIRMADA", createdAt: { gte: startOfMonth }, ...branchScope } }),
      prisma.ppeItem.findMany({ where: { organizationId, status: "ATIVO" } }),
      prisma.branchStock.findMany({
        where: { organizationId, ...branchScope, ppeItem: { status: "ATIVO" } },
        include: { ppeItem: true, branch: true },
      }),
    ]);

    const estoqueCritico = branchStocks.filter((s) => s.estoqueAtual < s.estoqueMinimo).length;
    const caProximoVencimento = ppeItems.filter((i) => computeCaStatus(i.caValidade, now, thresholds) === "PROXIMO_VENCIMENTO").length;
    const caVencido = ppeItems.filter((i) => computeCaStatus(i.caValidade, now, thresholds) === "VENCIDO").length;

    const confirmedDeliveries = await prisma.delivery.findMany({
      where: { organizationId, status: "CONFIRMADA", ...branchScope },
      include: { items: { include: { ppeItem: true } }, employee: { include: { department: true, branch: true } } },
    });
    const returns = await prisma.ppeReturn.findMany({ where: { organizationId } });
    const returnedIds = new Set(returns.map((r) => r.deliveryItemId).filter(Boolean));

    let episProximosTroca = 0;
    let episVencidos = 0;
    const proximasTrocas: unknown[] = [];

    for (const delivery of confirmedDeliveries) {
      for (const item of delivery.items) {
        if (returnedIds.has(item.id) || item.status === "SUBSTITUIDO") continue;
        const status = computeLifecycleStatus(item.dataPrevistaTroca, now, thresholds);
        if (status === "VENCIDO") episVencidos++;
        if (status === "CRITICO" || status === "PROXIMO_DA_TROCA") {
          episProximosTroca++;
          proximasTrocas.push({
            employeeId: delivery.employeeId,
            employeeName: delivery.employee.nomeCompleto,
            branchName: delivery.employee.branch?.nome ?? null,
            ppeItem: item.ppeItem.nome,
            dataPrevistaTroca: item.dataPrevistaTroca,
            status,
          });
        }
      }
    }
    proximasTrocas.sort((a: any, b: any) => new Date(a.dataPrevistaTroca).getTime() - new Date(b.dataPrevistaTroca).getTime());

    // Gráfico: entregas dos últimos 6 meses
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const recentDeliveries = await prisma.delivery.findMany({
      where: { organizationId, status: "CONFIRMADA", createdAt: { gte: sixMonthsAgo }, ...branchScope },
      select: {
        createdAt: true,
        items: { select: { quantidade: true, custoUnitarioSnapshot: true, ppeItem: { select: { nome: true } } } },
        employee: { select: { department: { select: { nome: true } } } },
        branch: { select: { nome: true } },
      },
    });

    const monthLabels: string[] = [];
    const entregasPorMes = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthLabels.push(key);
      entregasPorMes.set(key, 0);
    }
    const custosPorMes = new Map<string, number>(monthLabels.map((m) => [m, 0]));
    const epiCount = new Map<string, number>();
    const setorCount = new Map<string, number>();
    const filialCount = new Map<string, number>();

    for (const d of recentDeliveries) {
      const key = `${d.createdAt.getFullYear()}-${String(d.createdAt.getMonth() + 1).padStart(2, "0")}`;
      if (entregasPorMes.has(key)) entregasPorMes.set(key, (entregasPorMes.get(key) ?? 0) + 1);
      const setorNome = d.employee.department?.nome ?? "Sem setor";
      setorCount.set(setorNome, (setorCount.get(setorNome) ?? 0) + 1);
      const filialNome = d.branch?.nome ?? "Sem filial";
      filialCount.set(filialNome, (filialCount.get(filialNome) ?? 0) + 1);
      for (const item of d.items) {
        epiCount.set(item.ppeItem.nome, (epiCount.get(item.ppeItem.nome) ?? 0) + item.quantidade);
        const custo = Number(item.custoUnitarioSnapshot) * item.quantidade;
        if (custosPorMes.has(key)) custosPorMes.set(key, (custosPorMes.get(key) ?? 0) + custo);
      }
    }

    const alertasRecentes = await prisma.alert.findMany({
      where: { organizationId, status: "ABERTO", ...alertBranchWhere },
      orderBy: [{ prioridade: "asc" }, { createdAt: "desc" }],
      take: 8,
      include: { branch: true },
    });

    const entregasRecentes = await prisma.delivery.findMany({
      where: { organizationId, ...branchScope },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { employee: true, items: true, branch: true },
    });

    const estoqueCriticoLista = branchStocks
      .filter((s) => s.estoqueAtual < s.estoqueMinimo)
      .sort((a, b) => a.estoqueAtual - a.estoqueMinimo - (b.estoqueAtual - b.estoqueMinimo))
      .slice(0, 8)
      .map((s) => ({
        id: s.id,
        nome: s.ppeItem.nome,
        filial: s.branch.nome,
        estoqueAtual: s.estoqueAtual,
        estoqueMinimo: s.estoqueMinimo,
      }));

    res.json({
      cards: {
        colaboradoresAtivos,
        episCadastrados,
        entregasNoMes,
        estoqueCritico,
        episProximosTroca,
        episVencidos,
        caProximoVencimento,
        caVencido,
      },
      charts: {
        entregasPorMes: monthLabels.map((m) => ({ mes: m, total: entregasPorMes.get(m) ?? 0 })),
        custosPorMes: monthLabels.map((m) => ({ mes: m, total: Math.round((custosPorMes.get(m) ?? 0) * 100) / 100 })),
        episMaisEntregues: Array.from(epiCount.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([nome, total]) => ({ nome, total })),
        entregasPorSetor: Array.from(setorCount.entries()).map(([setor, total]) => ({ setor, total })),
        entregasPorFilial: Array.from(filialCount.entries()).map(([filial, total]) => ({ filial, total })),
      },
      proximasTrocas: proximasTrocas.slice(0, 10),
      estoqueCriticoLista,
      alertasRecentes,
      entregasRecentes,
    });
  } catch (err) {
    next(err);
  }
});
