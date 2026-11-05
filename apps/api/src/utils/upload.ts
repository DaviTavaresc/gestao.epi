import multer from "multer";

// Os arquivos chegam em memória e quem grava é o módulo de armazenamento
// (disco local em desenvolvimento, Supabase Storage em produção). Guardar em
// memória mantém o limite de tamanho como única proteção necessária aqui, e
// evita deixar arquivo órfão em disco quando a requisição é recusada depois.
const allowedDocumentMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const allowedLogoMimeTypes = new Set(["image/jpeg", "image/png", "image/svg+xml"]);

export const uploadDocument = multer({
  storage: multer.memoryStorage(),
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
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new Error("A foto de confirmação deve ser JPG, PNG ou WEBP."));
    }
    cb(null, true);
  },
});

export const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedLogoMimeTypes.has(file.mimetype)) {
      return cb(new Error("Tipo de arquivo não permitido. Envie JPG, PNG ou SVG."));
    }
    cb(null, true);
  },
});
