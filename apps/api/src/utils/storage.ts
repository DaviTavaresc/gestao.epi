// Armazenamento dos arquivos enviados: fotos de confirmação, notas fiscais e logo.
//
// Em desenvolvimento os arquivos ficam em disco, como sempre. Em produção o disco
// das hospedagens gratuitas é efêmero — ele é apagado a cada reinício ou deploy —,
// e perder a foto da confirmação significa perder a prova da entrega do EPI. Por isso
// o motor de produção é o Supabase Storage, escolhido por STORAGE_DRIVER=supabase.
import fs from "fs";
import path from "path";
import { env } from "../env";

export type Pasta = "documents" | "logos" | "confirmations";

export interface Armazenamento {
  salvar(pasta: Pasta, nome: string, conteudo: Buffer, mimeType: string): Promise<void>;
  ler(pasta: Pasta, nome: string): Promise<Buffer | null>;
  remover(pasta: Pasta, nome: string): Promise<void>;
  // Para mensagens de diagnóstico e para o script de migração.
  descricao(): string;
}

// Impede que um nome vindo do banco ou da requisição escape da pasta
// (../../etc/passwd) tanto no disco quanto na chave do bucket.
function nomeSeguro(nome: string): string {
  const base = path.basename(nome);
  if (!base || base === "." || base === "..") throw new Error("Nome de arquivo inválido.");
  return base;
}

class ArmazenamentoLocal implements Armazenamento {
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = raiz;
    for (const pasta of ["documents", "logos", "confirmations"] as Pasta[]) {
      fs.mkdirSync(path.join(raiz, pasta), { recursive: true });
    }
  }

  private caminho(pasta: Pasta, nome: string): string {
    return path.join(this.raiz, pasta, nomeSeguro(nome));
  }

  async salvar(pasta: Pasta, nome: string, conteudo: Buffer): Promise<void> {
    await fs.promises.writeFile(this.caminho(pasta, nome), conteudo);
  }

  async ler(pasta: Pasta, nome: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(this.caminho(pasta, nome));
    } catch {
      return null;
    }
  }

  async remover(pasta: Pasta, nome: string): Promise<void> {
    try {
      await fs.promises.unlink(this.caminho(pasta, nome));
    } catch {
      // arquivo já não existe: nada a fazer
    }
  }

  descricao(): string {
    return `disco local em ${this.raiz}`;
  }
}

type ClienteSupabase = {
  storage: {
    from(bucket: string): {
      upload(chave: string, conteudo: Buffer, opcoes: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
      download(chave: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      remove(chaves: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
};

class ArmazenamentoSupabase implements Armazenamento {
  private readonly cliente: ClienteSupabase;
  private readonly bucket: string;

  constructor(url: string, chaveServico: string, bucket: string) {
    // Importado sob demanda: quem roda com disco local não precisa da dependência.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require("@supabase/supabase-js");
    this.cliente = createClient(url, chaveServico, { auth: { persistSession: false } });
    this.bucket = bucket;
  }

  private chave(pasta: Pasta, nome: string): string {
    return `${pasta}/${nomeSeguro(nome)}`;
  }

  async salvar(pasta: Pasta, nome: string, conteudo: Buffer, mimeType: string): Promise<void> {
    const { error } = await this.cliente.storage
      .from(this.bucket)
      .upload(this.chave(pasta, nome), conteudo, { contentType: mimeType, upsert: true });
    if (error) throw new Error(`Falha ao gravar o arquivo no Supabase Storage: ${error.message}`);
  }

  async ler(pasta: Pasta, nome: string): Promise<Buffer | null> {
    const { data, error } = await this.cliente.storage.from(this.bucket).download(this.chave(pasta, nome));
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async remover(pasta: Pasta, nome: string): Promise<void> {
    await this.cliente.storage.from(this.bucket).remove([this.chave(pasta, nome)]);
  }

  descricao(): string {
    return `Supabase Storage, bucket "${this.bucket}"`;
  }
}

function criar(): Armazenamento {
  if (env.storageDriver === "supabase") {
    if (!env.supabaseUrl || !env.supabaseServiceKey) {
      throw new Error(
        "STORAGE_DRIVER=supabase exige SUPABASE_URL e SUPABASE_SERVICE_KEY. " +
          "Sem elas as fotos de confirmação e as notas fiscais não teriam onde ser gravadas."
      );
    }
    return new ArmazenamentoSupabase(env.supabaseUrl, env.supabaseServiceKey, env.supabaseBucket);
  }
  return new ArmazenamentoLocal(path.resolve(process.cwd(), env.uploadDir));
}

export const armazenamento = criar();

// Nome único para o arquivo gravado, preservando a extensão de acordo com o tipo.
export function nomeUnico(mimeType: string, extensaoPadrao = ".jpg"): string {
  const extensoes: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
  };
  const ext = extensoes[mimeType] ?? extensaoPadrao;
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}
