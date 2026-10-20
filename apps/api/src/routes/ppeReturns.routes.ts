import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";
import { applyStockMovement } from "../utils/stock";
import { resolveBranchFilter } from "../utils/branchScope";

export const ppeReturnsRouter = Router();
ppeReturnsRouter.use(requireAuth, requireWriteRole("ALMOXARIFADO"));

ppeReturnsRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const employeeId = req.query.employeeId as string | undefined;
    const ppeItemId = req.query.ppeItemId as string | undefined;

    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);
    const where = {
      organizationId,
      ...(branchScope.branchId ? { employee: { branchId: branchScope.branchId } } : {}),
      ...(employeeId ? { employeeId } : {}),
      ...(ppeItemId ? { ppeItemId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.ppeReturn.findMany({
        where,
        orderBy: { dataDevolucao: "desc" },
        ...toSkipTake(pagination),
        include: { employee: { include: { branch: true } }, ppeItem: true, user: { select: { id: true, name: true } } },
      }),
      prisma.ppeReturn.count({ where }),
    ]);

    res.json(buildPageResult(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  employeeId: z.string().min(1),
  ppeItemId: z.string().min(1),
  deliveryItemId: z.string().optional().nullable(),
  quantidade: z.coerce.number().int().positive(),
  dataDevolucao: z.coerce.date(),
  motivo: z.enum(["TROCA", "DESLIGAMENTO", "VENCIMENTO", "DANIFICACAO", "APOSENTADORIA", "OUTRO"]),
  estado: z.enum(["BOM", "REGULAR", "DANIFICADO", "INUTILIZAVEL"]),
  observacoes: z.string().optional().nullable(),
});

ppeReturnsRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = createSchema.parse(req.body);

    const [employee, ppeItem] = await Promise.all([
      prisma.employee.findFirst({
        where: { id: data.employeeId, organizationId, ...resolveBranchFilter(req.user!) },
        include: { branch: true },
      }),
      prisma.ppeItem.findFirst({ where: { id: data.ppeItemId, organizationId } }),
    ]);
    if (!employee) throw badRequest("Colaborador inválido.");
    if (!ppeItem) throw badRequest("EPI inválido.");
    if (!employee.branchId) throw badRequest("Colaborador sem filial definida.");

    if (data.deliveryItemId) {
      const deliveryItem = await prisma.deliveryItem.findFirst({ where: { id: data.deliveryItemId } });
      if (!deliveryItem) throw badRequest("Item de entrega inválido.");
      const alreadyReturned = await prisma.ppeReturn.findFirst({ where: { deliveryItemId: data.deliveryItemId } });
      if (alreadyReturned) throw conflict("Este item de entrega já foi devolvido anteriormente.");
    }

    // Apenas itens em boas condições reutilizáveis retornam ao estoque.
    const retornouEstoque = data.estado === "BOM" || data.estado === "REGULAR";

    const result = await prisma.$transaction(async (tx) => {
      const ppeReturn = await tx.ppeReturn.create({
        data: { ...data, organizationId, userId, retornouEstoque },
      });

      // Item reutilizável volta para o estoque da filial do colaborador.
      if (retornouEstoque) {
        await applyStockMovement(tx, {
          organizationId,
          branchId: employee.branchId!,
          ppeItemId: ppeItem.id,
          tipo: "DEVOLUCAO",
          quantidade: data.quantidade,
          motivo: `Devolução de ${employee.nomeCompleto} (${data.motivo})`,
          referencia: ppeReturn.id,
          userId,
        });
      }

      if (data.deliveryItemId) {
        await tx.deliveryItem.update({ where: { id: data.deliveryItemId }, data: { status: "DEVOLVIDO" } });
      }

      await writeAuditLog(tx, { organizationId, userId, action: "DEVOLUCAO", entityType: "PpeReturn", entityId: ppeReturn.id, newData: data });

      return ppeReturn;
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
