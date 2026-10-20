import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";

export const ppeKitsRouter = Router();
ppeKitsRouter.use(requireAuth, requireWriteRole("SEGURANCA_TRABALHO"));

const kitItemSchema = z.object({ ppeItemId: z.string().min(1), quantidade: z.coerce.number().int().positive() });
const upsertSchema = z.object({
  nome: z.string().min(2),
  descricao: z.string().optional().nullable(),
  items: z.array(kitItemSchema).min(1),
});

ppeKitsRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const status = req.query.status as string | undefined;
    const kits = await prisma.ppeKit.findMany({
      where: { organizationId, ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}) },
      orderBy: { nome: "asc" },
      include: { items: { include: { ppeItem: true } } },
    });
    res.json(kits);
  } catch (err) {
    next(err);
  }
});

ppeKitsRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const kit = await prisma.ppeKit.findFirst({
      where: { id: req.params.id, organizationId },
      include: { items: { include: { ppeItem: true } } },
    });
    if (!kit) throw notFound("Kit não encontrado.");
    res.json(kit);
  } catch (err) {
    next(err);
  }
});

async function validateItems(organizationId: string, items: { ppeItemId: string }[]) {
  const ids = items.map((i) => i.ppeItemId);
  const count = await prisma.ppeItem.count({ where: { id: { in: ids }, organizationId } });
  if (count !== new Set(ids).size) throw badRequest("Um ou mais EPIs informados são inválidos.");
}

ppeKitsRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);
    await validateItems(organizationId, data.items);

    const kit = await prisma.$transaction(async (tx) => {
      const created = await tx.ppeKit.create({
        data: {
          organizationId,
          nome: data.nome,
          descricao: data.descricao,
          items: { create: data.items },
        },
        include: { items: { include: { ppeItem: true } } },
      });
      await writeAuditLog(tx, { organizationId, userId, action: "CRIACAO", entityType: "PpeKit", entityId: created.id, newData: data });
      return created;
    });

    res.status(201).json(kit);
  } catch (err) {
    next(err);
  }
});

ppeKitsRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);
    await validateItems(organizationId, data.items);

    const existing = await prisma.ppeKit.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Kit não encontrado.");

    const kit = await prisma.$transaction(async (tx) => {
      await tx.ppeKitItem.deleteMany({ where: { kitId: existing.id } });
      const updated = await tx.ppeKit.update({
        where: { id: existing.id },
        data: {
          nome: data.nome,
          descricao: data.descricao,
          items: { create: data.items },
        },
        include: { items: { include: { ppeItem: true } } },
      });
      await writeAuditLog(tx, { organizationId, userId, action: "ALTERACAO", entityType: "PpeKit", entityId: updated.id, newData: data });
      return updated;
    });

    res.json(kit);
  } catch (err) {
    next(err);
  }
});

ppeKitsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "INATIVO"]) }).parse(req.body);

    const existing = await prisma.ppeKit.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Kit não encontrado.");

    const kit = await prisma.ppeKit.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "PpeKit",
      entityId: kit.id,
      newData: { status },
    });

    res.json(kit);
  } catch (err) {
    next(err);
  }
});

ppeKitsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.ppeKit.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Kit não encontrado.");
    await prisma.ppeKit.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
