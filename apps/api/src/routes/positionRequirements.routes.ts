import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";

// Matriz Cargo x EPI — define quais EPIs são obrigatórios para cada cargo.
export const positionRequirementsRouter = Router();
positionRequirementsRouter.use(requireAuth, requireWriteRole("SEGURANCA_TRABALHO"));

positionRequirementsRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const positionId = req.query.positionId as string | undefined;

    const requirements = await prisma.positionPpeRequirement.findMany({
      where: { organizationId, ...(positionId ? { positionId } : {}) },
      include: { position: true, ppeItem: { include: { category: true } } },
      orderBy: [{ position: { nome: "asc" } }, { ppeItem: { nome: "asc" } }],
    });

    res.json(requirements);
  } catch (err) {
    next(err);
  }
});

const upsertSchema = z.object({
  positionId: z.string().min(1),
  ppeItemId: z.string().min(1),
  quantidade: z.coerce.number().int().positive(),
  vidaUtilDiasOverride: z.coerce.number().int().positive().optional().nullable(),
});

positionRequirementsRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const [position, ppeItem] = await Promise.all([
      prisma.position.findFirst({ where: { id: data.positionId, organizationId } }),
      prisma.ppeItem.findFirst({ where: { id: data.ppeItemId, organizationId } }),
    ]);
    if (!position) throw badRequest("Cargo inválido.");
    if (!ppeItem) throw badRequest("EPI inválido.");

    const existing = await prisma.positionPpeRequirement.findUnique({
      where: { positionId_ppeItemId: { positionId: data.positionId, ppeItemId: data.ppeItemId } },
    });
    if (existing) throw conflict("Este EPI já está vinculado a este cargo.");

    const requirement = await prisma.positionPpeRequirement.create({
      data: { ...data, organizationId },
      include: { position: true, ppeItem: true },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "CRIACAO",
      entityType: "PositionPpeRequirement",
      entityId: requirement.id,
      newData: data,
    });

    res.status(201).json(requirement);
  } catch (err) {
    next(err);
  }
});

positionRequirementsRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const schema = z.object({
      quantidade: z.coerce.number().int().positive(),
      vidaUtilDiasOverride: z.coerce.number().int().positive().optional().nullable(),
    });
    const data = schema.parse(req.body);

    const existing = await prisma.positionPpeRequirement.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Vínculo não encontrado.");

    const requirement = await prisma.positionPpeRequirement.update({
      where: { id: existing.id },
      data,
      include: { position: true, ppeItem: true },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "PositionPpeRequirement",
      entityId: requirement.id,
      oldData: existing,
      newData: data,
    });

    res.json(requirement);
  } catch (err) {
    next(err);
  }
});

positionRequirementsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const existing = await prisma.positionPpeRequirement.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Vínculo não encontrado.");

    await prisma.positionPpeRequirement.delete({ where: { id: existing.id } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "PositionPpeRequirement",
      entityId: existing.id,
      oldData: existing,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
