import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",

  // Pasta do frontend já compilado. Vazio em desenvolvimento, onde o Vite serve o
  // site em :5173 e repassa /api para cá. Em produção esta mesma aplicação entrega
  // o site, para que site e API fiquem na MESMA origem: o cookie de refresh é
  // SameSite=Lax e o navegador não o envia entre domínios diferentes.
  // O caminho é resolvido a partir de apps/api, não do diretório de trabalho.
  serveWebDir: process.env.SERVE_WEB_DIR ?? "",

  // Onde ficam as fotos de confirmação, as notas fiscais e o logo.
  // "local" grava em disco (desenvolvimento); "supabase" grava no Supabase Storage,
  // obrigatório em hospedagem gratuita porque lá o disco é apagado a cada deploy.
  storageDriver: (process.env.STORAGE_DRIVER ?? "local") as "local" | "supabase",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? "",
  supabaseBucket: process.env.SUPABASE_BUCKET ?? "epi-arquivos",
};

if (!["local", "supabase"].includes(env.storageDriver)) {
  throw new Error(`STORAGE_DRIVER inválido: "${env.storageDriver}". Use "local" ou "supabase".`);
}
