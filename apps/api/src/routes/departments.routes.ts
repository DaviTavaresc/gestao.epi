import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";

export const departmentsRouter = Router();
departmentsRouter.use(requireAuth, requireWriteRole("SEGURANCA_TRABALHO"));

const upsertSchema = z.object({
  nome: z.string().min(2),
  descricao: z.string().optional().nullable(),
  responsavel: z.string().optional().nullable(),
});

departmentsRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const search = (req.query.search as string | undefined)?.trim();
    const status = req.query.status as string | undefined;

    const where = {
      organizationId,
      ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}),
      ...(search ? { nome: { contains: search, mode: "insensitive" as const } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.department.findMany({
        where,
        orderBy: { nome: "asc" },
        ...toSkipTake(pagination),
        include: { _count: { select: { employees: true } } },
      }),
      prisma.department.count({ where }),
    ]);

    res.json(buildPageResult(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

departmentsRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const department = await prisma.department.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { employees: true } } },
    });
    if (!department) throw notFound("Setor não encontrado.");
    res.json(department);
  } catch (err) {
    next(err);
  }
});

departmentsRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.department.findFirst({ where: { organizationId, nome: data.nome } });
    if (existing) throw conflict("Já existe um setor com este nome.");

    const department = await prisma.department.create({ data: { ...data, organizationId } });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "Department", entityId: department.id, newData: data });

    res.status(201).json(department);
  } catch (err) {
    next(err);
  }
});

departmentsRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.department.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Setor não encontrado.");

    const duplicate = await prisma.department.findFirst({
      where: { organizationId, nome: data.nome, NOT: { id: existing.id } },
    });
    if (duplicate) throw conflict("Já existe um setor com este nome.");

    const department = await prisma.department.update({ where: { id: existing.id }, data });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "Department",
      entityId: department.id,
      oldData: existing,
      newData: data,
    });

    res.json(department);
  } catch (err) {
    next(err);
  }
});

departmentsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const schema = z.object({ status: z.enum(["ATIVO", "INATIVO"]) });
    const { status } = schema.parse(req.body);

    const existing = await prisma.department.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Setor não encontrado.");

    const department = await prisma.department.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "Department",
      entityId: department.id,
      oldData: { status: existing.status },
      newData: { status },
    });

    res.json(department);
  } catch (err) {
    next(err);
  }
});

departmentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.department.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { employees: true } } },
    });
    if (!existing) throw notFound("Setor não encontrado.");
    if (existing._count.employees > 0) {
      throw badRequest("Não é possível excluir um setor com colaboradores vinculados. Inative-o em vez disso.");
    }
    await prisma.department.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
