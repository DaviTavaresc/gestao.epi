import { Router } from "express";
import path from "path";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";
import { uploadLogo } from "../utils/upload";
import { armazenamento } from "../utils/storage";
import { booleanDoFormulario } from "../utils/zodHelpers";

export const organizationRouter = Router();

// Logo é um asset de marca de baixa sensibilidade (exibido em PDFs e na UI);
// serve publicamente por nome de arquivo para simplificar o uso em <img> sem necessidade de header Authorization.
organizationRouter.get("/logo/:filename", async (req, res, next) => {
  try {
    const nome = path.basename(req.params.filename);
    const conteudo = await armazenamento.ler("logos", nome);
    if (!conteudo) throw notFound("Logo não encontrada.");
    const extensao = path.extname(nome).toLowerCase();
    const tipos: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };
    res.setHeader("Content-Type", tipos[extensao] ?? "application/octet-stream");
    res.send(conteudo);
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
  exigirFotoConfirmacao: booleanDoFormulario(true).optional(),
});

organizationRouter.put("/", requireRole("ADMIN", "RH"), async (req, res, next) => {
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

organizationRouter.post("/logo", requireRole("ADMIN", "RH"), uploadLogo.single("logo"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    if (!req.file) throw badRequest("Nenhum arquivo enviado.");

    // O nome é fixo por organização, então trocar o logo substitui o anterior.
    const extensoes: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg" };
    const nome = `${organizationId}${extensoes[req.file.mimetype] ?? ".png"}`;
    await armazenamento.salvar("logos", nome, req.file.buffer, req.file.mimetype);

    const logoUrl = `/api/organization/logo/${encodeURIComponent(nome)}`;
    const organization = await prisma.organization.update({ where: { id: organizationId }, data: { logoUrl } });
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "Organization", entityId: organizationId, newData: { logoUrl } });

    res.json(organization);
  } catch (err) {
    next(err);
  }
});
