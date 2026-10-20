import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";
import { canAccessAllBranches } from "../utils/branchScope";

export const branchesRouter = Router();
branchesRouter.use(requireAuth);

const upsertSchema = z.object({
  nome: z.string().min(2),
  codigo: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  uf: z.string().max(2).optional().nullable(),
  cidade: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(),
  responsavel: z.string().optional().nullable(),
});

// Listagem: usuários restritos a uma filial só enxergam a própria.
branchesRouter.get("/", async (req, res, next) => {
  try {
    const user = req.user!;
    const status = req.query.status as string | undefined;

    const branches = await prisma.branch.findMany({
      where: {
        organizationId: user.organizationId,
        ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}),
        ...(canAccessAllBranches(user) ? {} : { id: user.branchId! }),
      },
      orderBy: { nome: "asc" },
      // Conta apenas colaboradores ativos — desligados não representam a operação da filial.
      include: { _count: { select: { employees: { where: { status: "ATIVO" } }, stocks: true } } },
    });

    res.json(branches);
  } catch (err) {
    next(err);
  }
});

branchesRouter.get("/:id", async (req, res, next) => {
  try {
    const user = req.user!;
    const branch = await prisma.branch.findFirst({
      where: {
        id: req.params.id,
        organizationId: user.organizationId,
        ...(canAccessAllBranches(user) ? {} : { id: user.branchId! }),
      },
      include: { _count: { select: { employees: true, deliveries: true } } },
    });
    if (!branch) throw notFound("Filial não encontrada.");
    res.json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.post("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { organizationId, nome: data.nome } });
    if (existing) throw conflict("Já existe uma filial com este nome.");

    const branch = await prisma.branch.create({
      data: { ...data, uf: data.uf?.toUpperCase() ?? null, organizationId },
    });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "Branch", entityId: branch.id, newData: data });

    res.status(201).json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.put("/:id", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Filial não encontrada.");

    const duplicate = await prisma.branch.findFirst({
      where: { organizationId, nome: data.nome, NOT: { id: existing.id } },
    });
    if (duplicate) throw conflict("Já existe uma filial com este nome.");

    const branch = await prisma.branch.update({
      where: { id: existing.id },
      data: { ...data, uf: data.uf?.toUpperCase() ?? null },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "Branch",
      entityId: branch.id,
      oldData: existing,
      newData: data,
    });

    res.json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.patch("/:id/status", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "INATIVO"]) }).parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Filial não encontrada.");

    const branch = await prisma.branch.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "Branch",
      entityId: branch.id,
      newData: { status },
    });

    res.json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.delete("/:id", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.branch.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { employees: true, deliveries: true, stockMovements: true } } },
    });
    if (!existing) throw notFound("Filial não encontrada.");
    if (existing._count.employees > 0 || existing._count.deliveries > 0 || existing._count.stockMovements > 0) {
      throw badRequest("Esta filial possui histórico vinculado e não pode ser excluída. Inative-a em vez disso.");
    }
    await prisma.branchStock.deleteMany({ where: { branchId: existing.id } });
    await prisma.branch.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
