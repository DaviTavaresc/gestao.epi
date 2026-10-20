import { Router } from "express";
import path from "path";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";
import { uploadLogo, logosDir } from "../utils/upload";
import fs from "fs";

export const organizationRouter = Router();

// Logo é um asset de marca de baixa sensibilidade (exibido em PDFs e na UI);
// serve publicamente por nome de arquivo para simplificar o uso em <img> sem necessidade de header Authorization.
organizationRouter.get("/logo/:filename", (req, res, next) => {
  try {
    const filePath = path.join(logosDir, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) throw notFound("Logo não encontrada.");
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

organizationRouter.use(requireAuth);

organizationRouter.get("/", async (req, res, next) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: req.user!.organizationId } });
    if (!organization) throw notFound("Organização não encontrada.");
    res.json(organization);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  razaoSocial: z.string().min(2),
  nomeFantasia: z.string().optional().nullable(),
  telefone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  endereco: z.string().optional().nullable(),
  alertDaysCritico: z.coerce.number().int().min(1).max(90),
  alertDaysAtencao: z.coerce.number().int().min(1).max(90),
  alertDaysProximo: z.coerce.number().int().min(1).max(180),
  exigirFotoConfirmacao: z.coerce.boolean().optional(),
});

organizationRouter.put("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = updateSchema.parse(req.body);

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: { ...data, email: data.email || null },
    });
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "Organization", entityId: organizationId, newData: data });

    res.json(organization);
  } catch (err) {
    next(err);
  }
});

organizationRouter.post("/logo", requireRole("ADMIN"), uploadLogo.single("logo"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    if (!req.file) throw badRequest("Nenhum arquivo enviado.");

    const logoUrl = `/api/organization/logo/${encodeURIComponent(req.file.filename)}`;
    const organization = await prisma.organization.update({ where: { id: organizationId }, data: { logoUrl } });
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "Organization", entityId: organizationId, newData: { logoUrl } });

    res.json(organization);
  } catch (err) {
    next(err);
  }
});
