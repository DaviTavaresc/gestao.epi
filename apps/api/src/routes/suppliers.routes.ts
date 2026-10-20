import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth, requireWriteRole("ALMOXARIFADO"));

const upsertSchema = z.object({
  razaoSocial: z.string().min(2),
  nomeFantasia: z.string().optional().nullable(),
  cnpj: z.string().min(11),
  telefone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  endereco: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

suppliersRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const search = (req.query.search as string | undefined)?.trim();
    const status = req.query.status as string | undefined;

    const where = {
      organizationId,
      ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}),
      ...(search
        ? {
            OR: [
              { razaoSocial: { contains: search, mode: "insensitive" as const } },
              { nomeFantasia: { contains: search, mode: "insensitive" as const } },
              { cnpj: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: { razaoSocial: "asc" }, ...toSkipTake(pagination) }),
      prisma.supplier.count({ where }),
    ]);

    res.json(buildPageResult(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

suppliersRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const supplier = await prisma.supplier.findFirst({
      where: { id: req.params.id, organizationId },
      include: { purchases: { orderBy: { dataCompra: "desc" }, take: 20 } },
    });
    if (!supplier) throw notFound("Fornecedor não encontrado.");
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

suppliersRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.supplier.findFirst({ where: { organizationId, cnpj: data.cnpj } });
    if (existing) throw conflict("Já existe um fornecedor com este CNPJ.");

    const supplier = await prisma.supplier.create({ data: { ...data, email: data.email || null, organizationId } });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "Supplier", entityId: supplier.id, newData: data });

    res.status(201).json(supplier);
  } catch (err) {
    next(err);
  }
});

suppliersRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Fornecedor não encontrado.");

    const duplicate = await prisma.supplier.findFirst({ where: { organizationId, cnpj: data.cnpj, NOT: { id: existing.id } } });
    if (duplicate) throw conflict("Já existe um fornecedor com este CNPJ.");

    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data: { ...data, email: data.email || null } });
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "Supplier", entityId: supplier.id, oldData: existing, newData: data });

    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

suppliersRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "INATIVO"]) }).parse(req.body);

    const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Fornecedor não encontrado.");

    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "Supplier",
      entityId: supplier.id,
      oldData: { status: existing.status },
      newData: { status },
    });

    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

suppliersRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.supplier.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { purchases: true } } },
    });
    if (!existing) throw notFound("Fornecedor não encontrado.");
    if (existing._count.purchases > 0) throw badRequest("Não é possível excluir um fornecedor com compras vinculadas.");
    await prisma.supplier.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
