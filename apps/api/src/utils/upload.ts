import fs from "fs";
import path from "path";
import multer from "multer";
import { env } from "../env";

export const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
export const documentsDir = path.join(uploadRoot, "documents");
export const logosDir = path.join(uploadRoot, "logos");
export const confirmationPhotosDir = path.join(uploadRoot, "confirmations");

for (const dir of [uploadRoot, documentsDir, logosDir, confirmationPhotosDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const allowedDocumentMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const allowedLogoMimeTypes = new Set(["image/jpeg", "image/png", "image/svg+xml"]);

export const uploadDocument = multer({
  storage: multer.diskStorage({
    destination: documentsDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedDocumentMimeTypes.has(file.mimetype)) {
      return cb(new Error("Tipo de arquivo não permitido. Envie PDF, JPG ou PNG."));
    }
    cb(null, true);
  },
});

// Foto capturada pela câmera na confirmação de recebimento.
// Só aceita imagem e limita o tamanho — a captura do front já envia JPEG comprimido.
export const uploadConfirmationPhoto = multer({
  storage: multer.diskStorage({
    destination: confirmationPhotosDir,
    filename: (_req, file, cb) => {
      const ext = file.mimetype === "image/png" ? ".png" : ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new Error("A foto de confirmação deve ser JPG, PNG ou WEBP."));
    }
    cb(null, true);
  },
});

export const uploadLogo = multer({
  storage: multer.diskStorage({
    destination: logosDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${req.user!.organizationId}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedLogoMimeTypes.has(file.mimetype)) {
      return cb(new Error("Tipo de arquivo não permitido. Envie JPG, PNG ou SVG."));
    }
    cb(null, true);
  },
});
