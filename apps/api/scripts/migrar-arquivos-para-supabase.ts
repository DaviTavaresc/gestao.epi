// Copia os arquivos que hoje estão em disco (fotos de confirmação, notas fiscais e
// logos) para o Supabase Storage, e confere um por um se chegaram inteiros.
//
// Não apaga nada do disco: o original continua lá até você conferir o resultado.
//
// Uso:
//   cd apps/api
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SUPABASE_BUCKET=epi-arquivos \
//     npx tsx scripts/migrar-arquivos-para-supabase.ts
//
// Passe --forcar para reenviar arquivos que já existem no bucket.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const PASTAS = ["documents", "logos", "confirmations"] as const;

const TIPOS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

async function main() {
  const forcar = process.argv.includes("--forcar");
  const url = exigir("SUPABASE_URL");
  const chave = exigir("SUPABASE_SERVICE_KEY");
  const bucket = process.env.SUPABASE_BUCKET ?? "epi-arquivos";
  const raiz = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./uploads");

  if (!fs.existsSync(raiz)) throw new Error(`Pasta de uploads não encontrada: ${raiz}`);

  const cliente = createClient(url, chave, { auth: { persistSession: false } });

  console.log("Origem :", raiz);
  console.log("Destino: Supabase Storage, bucket", bucket);
  console.log("");

  let enviados = 0;
  let pulados = 0;
  const falhas: string[] = [];

  for (const pasta of PASTAS) {
    const dir = path.join(raiz, pasta);
    if (!fs.existsSync(dir)) {
      console.log(`${pasta}: pasta não existe na origem, nada a fazer`);
      continue;
    }
    const arquivos = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
    console.log(`${pasta}: ${arquivos.length} arquivo(s)`);

    for (const nome of arquivos) {
      const conteudo = fs.readFileSync(path.join(dir, nome));
      const destino = `${pasta}/${nome}`;
      const mimeType = TIPOS[path.extname(nome).toLowerCase()] ?? "application/octet-stream";

      if (!forcar) {
        const { data } = await cliente.storage.from(bucket).download(destino);
        if (data) {
          const jaLa = Buffer.from(await data.arrayBuffer());
          if (sha(jaLa) === sha(conteudo)) {
            pulados++;
            continue;
          }
        }
      }

      const { error } = await cliente.storage
        .from(bucket)
        .upload(destino, conteudo, { contentType: mimeType, upsert: true });
      if (error) {
        falhas.push(`${destino}: ${error.message}`);
        console.log(`   FALHOU ${nome}: ${error.message}`);
        continue;
      }

      // Confere byte a byte: arquivo truncado no upload seria pior que não migrar.
      const { data: devolta, error: erroLeitura } = await cliente.storage.from(bucket).download(destino);
      if (erroLeitura || !devolta) {
        falhas.push(`${destino}: gravou mas não conseguiu ler de volta`);
        console.log(`   FALHOU ${nome}: gravou mas não conseguiu ler de volta`);
        continue;
      }
      const conferido = Buffer.from(await devolta.arrayBuffer());
      if (sha(conferido) !== sha(conteudo)) {
        falhas.push(`${destino}: conteúdo diferente depois do upload`);
        console.log(`   FALHOU ${nome}: conteúdo diferente depois do upload`);
        continue;
      }

      enviados++;
      console.log(`   ok ${nome} (${conteudo.length} bytes)`);
    }
  }

  console.log("");
  console.log(`Enviados: ${enviados}   |   Já estavam lá: ${pulados}   |   Falhas: ${falhas.length}`);
  if (falhas.length) {
    console.log("\nFALHAS:");
    falhas.forEach((f) => console.log("  - " + f));
    console.log("\nNada foi apagado do disco. Corrija as falhas e rode de novo.");
    process.exit(1);
  }
  console.log("\nTodos os arquivos conferidos byte a byte no destino.");
  console.log("O disco local continua intacto — apague a pasta uploads só depois de validar o sistema no ar.");
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
