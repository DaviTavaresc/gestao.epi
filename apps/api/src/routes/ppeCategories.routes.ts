import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";

export const ppeCategoriesRouter = Router();
ppeCategoriesRouter.use(requireAuth, requireWriteRole("SEGURANCA_TRABALHO"));

const upsertSchema = z.object({
  nome: z.string().min(2),
  descricao: z.string().optional().nullable(),
});

ppeCategoriesRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const status = req.query.status as string | undefined;
    const categories = await prisma.ppeCategory.findMany({
      where: { organizationId, ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}) },
      orderBy: { nome: "asc" },
      include: { _count: { select: { items: true } } },
    });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

ppeCategoriesRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.ppeCategory.findFirst({ where: { organizationId, nome: data.nome } });
    if (existing) throw conflict("Já existe uma categoria com este nome.");

    const category = await prisma.ppeCategory.create({ data: { ...data, organizationId } });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "PpeCategory", entityId: category.id, newData: data });

    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

ppeCategoriesRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.ppeCategory.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Categoria não encontrada.");

    const category = await prisma.ppeCategory.update({ where: { id: existing.id }, data });
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "PpeCategory", entityId: category.id, oldData: existing, newData: data });

    res.json(category);
  } catch (err) {
    next(err);
  }
});

ppeCategoriesRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "INATIVO"]) }).parse(req.body);

    const existing = await prisma.ppeCategory.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Categoria não encontrada.");

    const category = await prisma.ppeCategory.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "PpeCategory",
      entityId: category.id,
      oldData: { status: existing.status },
      newData: { status },
    });

    res.json(category);
  } catch (err) {
    next(err);
  }
});

ppeCategoriesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.ppeCategory.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { items: true } } },
    });
    if (!existing) throw notFound("Categoria não encontrada.");
    if (existing._count.items > 0) throw badRequest("Não é possível excluir uma categoria com EPIs vinculados.");
    await prisma.ppeCategory.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
