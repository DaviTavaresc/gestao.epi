import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";
import { applyStockMovement } from "../utils/stock";
import { assertBranchAllowed, resolveBranchFilter } from "../utils/branchScope";

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth, requireWriteRole("ALMOXARIFADO"));

const itemSchema = z.object({
  ppeItemId: z.string().min(1),
  quantidade: z.coerce.number().int().positive(),
  valorUnitario: z.coerce.number().min(0),
});

const upsertSchema = z.object({
  branchId: z.string().min(1),
  numeroNf: z.string().min(1),
  supplierId: z.string().min(1),
  dataCompra: z.coerce.date(),
  observacoes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

function calcTotal(items: { quantidade: number; valorUnitario: number }[]) {
  return items.reduce((acc, i) => acc + i.quantidade * i.valorUnitario, 0);
}

purchasesRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status as string | undefined;
    const supplierId = req.query.supplierId as string | undefined;
    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);

    const where = {
      organizationId,
      ...branchScope,
      ...(status ? { status: status as never } : {}),
      ...(supplierId ? { supplierId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        orderBy: { dataCompra: "desc" },
        ...toSkipTake(pagination),
        include: { supplier: true, branch: true, items: true, _count: { select: { documents: true } } },
      }),
      prisma.purchase.count({ where }),
    ]);

    res.json(buildPageResult(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

purchasesRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const purchase = await prisma.purchase.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        supplier: true,
        branch: true,
        items: { include: { ppeItem: true } },
        documents: true,
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!purchase) throw notFound("Compra não encontrada.");
    res.json(purchase);
  } catch (err) {
    next(err);
  }
});

purchasesRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);
    assertBranchAllowed(req.user!, data.branchId);

    const [supplier, branch] = await Promise.all([
      prisma.supplier.findFirst({ where: { id: data.supplierId, organizationId } }),
      prisma.branch.findFirst({ where: { id: data.branchId, organizationId } }),
    ]);
    if (!supplier) throw badRequest("Fornecedor inválido.");
    if (!branch) throw badRequest("Filial inválida.");

    const itemIds = data.items.map((i) => i.ppeItemId);
    const validItemCount = await prisma.ppeItem.count({ where: { id: { in: itemIds }, organizationId } });
    if (validItemCount !== new Set(itemIds).size) throw badRequest("Um ou mais EPIs informados são inválidos.");

    const existing = await prisma.purchase.findFirst({ where: { organizationId, numeroNf: data.numeroNf, supplierId: data.supplierId } });
    if (existing) throw conflict("Já existe uma compra com esta NF para este fornecedor.");

    const valorTotal = calcTotal(data.items);

    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          organizationId,
          branchId: data.branchId,
          numeroNf: data.numeroNf,
          supplierId: data.supplierId,
          dataCompra: data.dataCompra,
          observacoes: data.observacoes,
          valorTotal,
          createdById: userId,
          status: "RASCUNHO",
          items: {
            create: data.items.map((i) => ({
              ppeItemId: i.ppeItemId,
              quantidade: i.quantidade,
              valorUnitario: i.valorUnitario,
              valorTotal: i.quantidade * i.valorUnitario,
            })),
          },
        },
        include: { items: true, supplier: true, branch: true },
      });
      await writeAuditLog(tx, { organizationId, userId, action: "CRIACAO", entityType: "Purchase", entityId: created.id, newData: data });
      return created;
    });

    res.status(201).json(purchase);
  } catch (err) {
    next(err);
  }
});

purchasesRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);
    assertBranchAllowed(req.user!, data.branchId);

    const existing = await prisma.purchase.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
    });
    if (!existing) throw notFound("Compra não encontrada.");
    if (existing.status !== "RASCUNHO") throw badRequest("Apenas compras em rascunho podem ser editadas.");

    const valorTotal = calcTotal(data.items);

    const purchase = await prisma.$transaction(async (tx) => {
      await tx.purchaseItem.deleteMany({ where: { purchaseId: existing.id } });
      const updated = await tx.purchase.update({
        where: { id: existing.id },
        data: {
          branchId: data.branchId,
          numeroNf: data.numeroNf,
          supplierId: data.supplierId,
          dataCompra: data.dataCompra,
          observacoes: data.observacoes,
          valorTotal,
          items: {
            create: data.items.map((i) => ({
              ppeItemId: i.ppeItemId,
              quantidade: i.quantidade,
              valorUnitario: i.valorUnitario,
              valorTotal: i.quantidade * i.valorUnitario,
            })),
          },
        },
        include: { items: true, supplier: true },
      });
      await writeAuditLog(tx, { organizationId, userId, action: "ALTERACAO", entityType: "Purchase", entityId: updated.id, newData: data });
      return updated;
    });

    res.json(purchase);
  } catch (err) {
    next(err);
  }
});

// Recebimento da compra: dá entrada no estoque, gera movimentações e trava reprocessamento.
purchasesRouter.post("/:id/receive", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;

    const purchase = await prisma.purchase.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: { items: { include: { ppeItem: true } }, branch: true },
    });
    if (!purchase) throw notFound("Compra não encontrada.");
    if (purchase.status === "RECEBIDA") throw conflict("Esta compra já foi recebida e processada no estoque.");
    if (purchase.status === "CANCELADA") throw badRequest("Compra cancelada não pode ser recebida.");

    const result = await prisma.$transaction(async (tx) => {
      for (const item of purchase.items) {
        await applyStockMovement(tx, {
          organizationId,
          branchId: purchase.branchId,
          ppeItemId: item.ppeItemId,
          tipo: "ENTRADA_COMPRA",
          quantidade: item.quantidade,
          motivo: `Recebimento da compra NF ${purchase.numeroNf} (${purchase.branch.nome})`,
          referencia: purchase.id,
          userId,
        });

        // O custo é atualizado SOMENTE na filial que recebeu a mercadoria —
        // o catálogo global permanece como referência para as demais.
        await tx.branchStock.update({
          where: { branchId_ppeItemId: { branchId: purchase.branchId, ppeItemId: item.ppeItemId } },
          data: { custoUnitario: item.valorUnitario },
        });
      }

      const updated = await tx.purchase.update({
        where: { id: purchase.id },
        data: { status: "RECEBIDA", processedAt: new Date() },
        include: { items: { include: { ppeItem: true } }, supplier: true, branch: true },
      });

      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "COMPRA",
        entityType: "Purchase",
        entityId: updated.id,
        newData: { status: "RECEBIDA" },
      });
      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "ENTRADA_ESTOQUE",
        entityType: "Purchase",
        entityId: updated.id,
        newData: { itens: purchase.items.length },
      });

      return updated;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

purchasesRouter.patch("/:id/cancel", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const existing = await prisma.purchase.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
    });
    if (!existing) throw notFound("Compra não encontrada.");
    if (existing.status === "RECEBIDA") throw badRequest("Compra já recebida não pode ser cancelada.");

    const purchase = await prisma.purchase.update({ where: { id: existing.id }, data: { status: "CANCELADA" } });
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "Purchase", entityId: purchase.id, newData: { status: "CANCELADA" } });

    res.json(purchase);
  } catch (err) {
    next(err);
  }
});
