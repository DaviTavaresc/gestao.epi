import { Router } from "express";
import fs from "fs";
import path from "path";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, forbidden, notFound } from "../utils/httpError";
import { uploadDocument, documentsDir } from "../utils/upload";
import { writeAuditLog } from "../utils/audit";

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireWriteRole("ALMOXARIFADO"));

documentsRouter.post("/purchases/:purchaseId", uploadDocument.single("file"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    if (!req.file) throw badRequest("Nenhum arquivo enviado.");

    const purchase = await prisma.purchase.findFirst({ where: { id: req.params.purchaseId, organizationId } });
    if (!purchase) {
      fs.unlinkSync(req.file.path);
      throw notFound("Compra não encontrada.");
    }

    const document = await prisma.document.create({
      data: {
        organizationId,
        purchaseId: purchase.id,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storagePath: req.file.filename,
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

    const filePath = path.join(documentsDir, document.storagePath);
    if (!filePath.startsWith(documentsDir)) throw forbidden();
    if (!fs.existsSync(filePath)) throw notFound("Arquivo não encontrado no armazenamento.");

    res.setHeader("Content-Type", document.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.fileName)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const document = await prisma.document.findFirst({ where: { id: req.params.id, organizationId } });
    if (!document) throw notFound("Documento não encontrado.");

    const filePath = path.join(documentsDir, document.storagePath);
    await prisma.document.delete({ where: { id: document.id } });
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "Document", entityId: document.id, oldData: { fileName: document.fileName } });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
