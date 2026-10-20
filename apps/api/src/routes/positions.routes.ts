import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";

export const positionsRouter = Router();
positionsRouter.use(requireAuth, requireWriteRole("SEGURANCA_TRABALHO"));

const upsertSchema = z.object({
  nome: z.string().min(2),
  descricao: z.string().optional().nullable(),
});

positionsRouter.get("/", async (req, res, next) => {
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
      prisma.position.findMany({
        where,
        orderBy: { nome: "asc" },
        ...toSkipTake(pagination),
        include: { _count: { select: { employees: true, requirements: true } } },
      }),
      prisma.position.count({ where }),
    ]);

    res.json(buildPageResult(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

positionsRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const position = await prisma.position.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        requirements: { include: { ppeItem: true } },
        _count: { select: { employees: true } },
      },
    });
    if (!position) throw notFound("Cargo não encontrado.");
    res.json(position);
  } catch (err) {
    next(err);
  }
});

positionsRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.position.findFirst({ where: { organizationId, nome: data.nome } });
    if (existing) throw conflict("Já existe um cargo com este nome.");

    const position = await prisma.position.create({ data: { ...data, organizationId } });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "Position", entityId: position.id, newData: data });

    res.status(201).json(position);
  } catch (err) {
    next(err);
  }
});

positionsRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.position.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Cargo não encontrado.");

    const duplicate = await prisma.position.findFirst({
      where: { organizationId, nome: data.nome, NOT: { id: existing.id } },
    });
    if (duplicate) throw conflict("Já existe um cargo com este nome.");

    const position = await prisma.position.update({ where: { id: existing.id }, data });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "Position",
      entityId: position.id,
      oldData: existing,
      newData: data,
    });

    res.json(position);
  } catch (err) {
    next(err);
  }
});

positionsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const schema = z.object({ status: z.enum(["ATIVO", "INATIVO"]) });
    const { status } = schema.parse(req.body);

    const existing = await prisma.position.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Cargo não encontrado.");

    const position = await prisma.position.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "Position",
      entityId: position.id,
      oldData: { status: existing.status },
      newData: { status },
    });

    res.json(position);
  } catch (err) {
    next(err);
  }
});

positionsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.position.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { employees: true } } },
    });
    if (!existing) throw notFound("Cargo não encontrado.");
    if (existing._count.employees > 0) {
      throw badRequest("Não é possível excluir um cargo com colaboradores vinculados. Inative-o em vez disso.");
    }
    await prisma.position.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
