// Cria o usuario administrador de um banco de producao que ja tem o cadastro.
//
// O usuario nao vem copiado do banco de desenvolvimento de proposito: senha de
// producao nao sai de um ambiente de teste. A senha provisoria e sorteada aqui e
// mostrada uma unica vez - ela serve para o primeiro acesso e deve ser trocada.
//
// Uso:
//   DESTINO_URL=<banco de producao> npx tsx prisma/criar-usuario-admin.ts \
//     --email pessoa@empresa.com.br --nome "Nome Completo" [--senha <senha>] [--aplicar]
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Senha sorteada com gerador criptografico, sem caracteres que se confundem na
// leitura (O/0, l/1), porque ela vai ser digitada a partir de uma tela.
function sortearSenha(tamanho = 20): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=?";
  const bytes = crypto.randomBytes(tamanho * 2);
  let senha = "";
  for (let i = 0; senha.length < tamanho; i++) senha += alfabeto[bytes[i] % alfabeto.length];
  return senha;
}

async function main() {
  const url = process.env.DESTINO_URL;
  if (!url) throw new Error("Defina DESTINO_URL com o banco de producao.");
  const email = (arg("email") ?? "").trim().toLowerCase();
  const nome = (arg("nome") ?? "").trim();
  const aplicar = process.argv.includes("--aplicar");

  if (!email || !email.includes("@")) throw new Error("Informe --email valido.");
  if (nome.length < 2) throw new Error("Informe --nome com o nome completo.");
  if (/demoepi\.com\.br$/i.test(email)) {
    throw new Error("Esse e o e-mail da demonstracao. Use o e-mail corporativo real.");
  }

  const senha = arg("senha") ?? sortearSenha();
  if (senha.length < 8) throw new Error("A senha precisa ter ao menos 8 caracteres.");

  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = await p.organization.findFirst({ select: { id: true, razaoSocial: true } });
    if (!org) throw new Error("O banco nao tem organizacao. Copie o cadastro antes de criar o usuario.");

    // E-mail e unico global: se ja existir, parar em vez de sobrescrever a senha
    // de alguem que talvez ja esteja usando o sistema.
    const existe = await p.user.findUnique({ where: { email }, select: { id: true } });
    if (existe) throw new Error(`Ja existe usuario com o e-mail ${email}. Nada foi alterado.`);

    console.log("empresa      :", org.razaoSocial);
    console.log("administrador:", nome, `<${email}>`);
    console.log("perfil       : ADMIN, sem filial (enxerga todas as empresas do grupo)");

    if (!aplicar) {
      console.log("\nSIMULACAO. Rode com --aplicar para criar.");
      return;
    }

    await p.user.create({
      data: {
        organizationId: org.id,
        name: nome,
        email,
        passwordHash: await bcrypt.hash(senha, 12),
        role: "ADMIN",
        // Administrador sem filial tem visao corporativa das oito empresas.
        branchId: null,
      },
    });

    console.log("\nCriado.");
    console.log("senha provisoria:", senha);
    console.log("Troque no primeiro acesso: ela aparece em tela e nao deve continuar valendo.");
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => { console.error("FALHOU:", e instanceof Error ? e.message : e); process.exitCode = 1; });
