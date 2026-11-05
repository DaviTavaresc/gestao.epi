import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, notFound } from "../utils/httpError";
import { uploadDocument } from "../utils/upload";
import { armazenamento, nomeUnico } from "../utils/storage";
import { writeAuditLog } from "../utils/audit";

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireWriteRole("ALMOXARIFADO"));

documentsRouter.post("/purchases/:purchaseId", uploadDocument.single("file"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    if (!req.file) throw badRequest("Nenhum arquivo enviado.");

    // A compra é validada antes de gravar o arquivo: assim não sobra arquivo órfão.
    const purchase = await prisma.purchase.findFirst({ where: { id: req.params.purchaseId, organizationId } });
    if (!purchase) throw notFound("Compra não encontrada.");

    const chave = nomeUnico(req.file.mimetype, ".pdf");
    await armazenamento.salvar("documents", chave, req.file.buffer, req.file.mimetype);

    const document = await prisma.document.create({
      data: {
        organizationId,
        purchaseId: purchase.id,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storagePath: chave,
        uploadedById: userId,
      },
    });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "Document", entityId: document.id, newData: { fileName: document.fileName, purchaseId: purchase.id } });

    res.status(201).json(document);
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id/download", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const document = await prisma.document.findFirst({ where: { id: req.params.id, organizationId } });
    if (!document) throw notFound("Documento não encontrado.");

    const conteudo = await armazenamento.ler("documents", document.storagePath);
    if (!conteudo) throw notFound("Arquivo não encontrado no armazenamento.");

    res.setHeader("Content-Type", document.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.fileName)}"`);
    res.send(conteudo);
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const document = await prisma.document.findFirst({ where: { id: req.params.id, organizationId } });
    if (!document) throw notFound("Documento não encontrado.");

    await prisma.document.delete({ where: { id: document.id } });
    await armazenamento.remover("documents", document.storagePath);
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "Document", entityId: document.id, oldData: { fileName: document.fileName } });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
