import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";
import { computeCaStatus } from "../utils/ppeStatus";
import { applyStockMovement, getOrCreateBranchStock, stockStatus } from "../utils/stock";
import { assertBranchAllowed, resolveBranchFilter } from "../utils/branchScope";

export const stockRouter = Router();
stockRouter.use(requireAuth, requireWriteRole("RH", "GERENTE"));

// Estoque atual por filial. Sem branchId, um usuário corporativo vê todas as filiais.
stockRouter.get("/current", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const search = (req.query.search as string | undefined)?.trim();
    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);

    const stocks = await prisma.branchStock.findMany({
      where: {
        organizationId,
        ...branchScope,
        ppeItem: {
          status: "ATIVO",
          ...(search ? { nome: { contains: search, mode: "insensitive" as const } } : {}),
        },
      },
      // A empresa dona da filial vem junto para a tela mostrar de qual CNPJ é o saldo.
      include: {
        ppeItem: { include: { category: true } },
        branch: { include: { parent: { select: { id: true, nome: true, cnpj: true } } } },
      },
      orderBy: [{ branch: { nome: "asc" } }, { ppeItem: { nome: "asc" } }],
    });

    const now = new Date();
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    const thresholds = { proximo: org!.alertDaysProximo, atencao: org!.alertDaysAtencao, critico: org!.alertDaysCritico };

    res.json(
      stocks.map((s) => ({
        id: s.id,
        branch: s.branch,
        ppeItem: s.ppeItem,
        estoqueAtual: s.estoqueAtual,
        estoqueMinimo: s.estoqueMinimo,
        estoqueMaximo: s.estoqueMaximo,
        custoUnitario: s.custoUnitario,
        stockStatus: stockStatus(s),
        caStatus: computeCaStatus(s.ppeItem.caValidade, now, thresholds),
      }))
    );
  } catch (err) {
    next(err);
  }
});

stockRouter.get("/movements", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const ppeItemId = req.query.ppeItemId as string | undefined;
    const tipo = req.query.tipo as string | undefined;
    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);

    const where = {
      organizationId,
      ...branchScope,
      ...(ppeItemId ? { ppeItemId } : {}),
      ...(tipo ? { tipo: tipo as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
        include: { ppeItem: true, branch: true, user: { select: { id: true, name: true } } },
      }),
      prisma.stockMovement.count({ where }),
    ]);

    res.json(buildPageResult(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

const adjustSchema = z.object({
  branchId: z.string().min(1),
  ppeItemId: z.string().min(1),
  tipo: z.enum(["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "PERDA", "DANIFICACAO", "DESCARTE"]),
  quantidade: z.coerce.number().int().positive(),
  motivo: z.string().min(3),
});

stockRouter.post("/movements", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = adjustSchema.parse(req.body);
    assertBranchAllowed(req.user!, data.branchId);

    const [branch, item] = await Promise.all([
      prisma.branch.findFirst({ where: { id: data.branchId, organizationId } }),
      prisma.ppeItem.findFirst({ where: { id: data.ppeItemId, organizationId } }),
    ]);
    if (!branch) throw badRequest("Filial inválida.");
    if (!item) throw notFound("EPI não encontrado.");

    const result = await prisma.$transaction(async (tx) => {
      const { movement } = await applyStockMovement(tx, {
        organizationId,
        branchId: data.branchId,
        ppeItemId: data.ppeItemId,
        tipo: data.tipo,
        quantidade: data.quantidade,
        motivo: data.motivo,
        userId,
      });
      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "AJUSTE_ESTOQUE",
        entityType: "StockMovement",
        entityId: movement.id,
        newData: data,
      });
      return movement;
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// Ajusta os parâmetros do EPI em uma filial específica: limites e custo unitário.
const limitsSchema = z.object({
  branchId: z.string().min(1),
  ppeItemId: z.string().min(1),
  estoqueMinimo: z.coerce.number().int().min(0),
  estoqueMaximo: z.coerce.number().int().min(0),
  custoUnitario: z.coerce.number().min(0).optional(),
});

// Tira o EPI do estoque de uma filial: some a linha da tela de Estoque atual.
// É para o item que foi parar ali por engano ou que aquela unidade não usa mais.
//
// Só com saldo zerado. Apagar uma linha com saldo faria a quantidade sumir sem
// deixar rastro no livro de movimentações, que é onde se explica cada entrada e
// cada saída. Quem precisa dar baixa usa Ajustar, informa o motivo, e aí remove.
stockRouter.delete("/current/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;

    const stock = await prisma.branchStock.findFirst({
      where: { id: req.params.id, organizationId },
      include: { ppeItem: { select: { nome: true } }, branch: { select: { nome: true } } },
    });
    if (!stock) throw notFound("Item de estoque não encontrado.");
    assertBranchAllowed(req.user!, stock.branchId);

    if (stock.estoqueAtual !== 0) {
      throw badRequest(
        `Este EPI ainda tem ${stock.estoqueAtual} em estoque nesta filial. ` +
          `Zere o saldo em Ajustar, informando o motivo, antes de remover o item da filial.`
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.branchStock.delete({ where: { id: stock.id } });
      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "ALTERACAO",
        entityType: "BranchStock",
        entityId: stock.id,
        oldData: {
          epi: stock.ppeItem.nome,
          filial: stock.branch.nome,
          estoqueMinimo: stock.estoqueMinimo,
          estoqueMaximo: stock.estoqueMaximo,
        },
        newData: { removidoDaFilial: true },
      });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

stockRouter.put("/limits", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = limitsSchema.parse(req.body);
    assertBranchAllowed(req.user!, data.branchId);

    const stock = await prisma.$transaction(async (tx) => {
      const current = await getOrCreateBranchStock(tx, organizationId, data.branchId, data.ppeItemId);
      const updated = await tx.branchStock.update({
        where: { id: current.id },
        data: {
          estoqueMinimo: data.estoqueMinimo,
          estoqueMaximo: data.estoqueMaximo,
          ...(data.custoUnitario !== undefined ? { custoUnitario: data.custoUnitario } : {}),
        },
      });
      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "ALTERACAO",
        entityType: "BranchStock",
        entityId: updated.id,
        oldData: { estoqueMinimo: current.estoqueMinimo, estoqueMaximo: current.estoqueMaximo, custoUnitario: current.custoUnitario },
        newData: { estoqueMinimo: data.estoqueMinimo, estoqueMaximo: data.estoqueMaximo, custoUnitario: data.custoUnitario ?? current.custoUnitario },
      });
      return updated;
    });

    res.json(stock);
  } catch (err) {
    next(err);
  }
});
