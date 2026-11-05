// Prepara um banco de producao limpo: cria a empresa, o administrador, as filiais
// e copia o cadastro base de EPIs do banco de origem (sem estoque, entregas,
// compras, devolucoes, cobrancas, alertas nem auditoria).
//
// Uso:
//   DATABASE_URL=<banco de producao> ORIGEM_URL=<banco de origem> \
//     npx tsx prisma/provisionar-producao.ts prisma/producao.json
//
// O arquivo JSON descreve a empresa, o administrador e as filiais. Veja
// prisma/producao.exemplo.json.
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

type Config = {
  empresa: {
    razaoSocial: string;
    nomeFantasia?: string | null;
    cnpj: string;
    telefone?: string | null;
    email?: string | null;
    endereco?: string | null;
  };
  administrador: { nome: string; email: string; senhaProvisoria: string };
  filiais: {
    nome: string;
    codigo?: string | null;
    cnpj?: string | null;
    uf?: string | null;
    cidade?: string | null;
    endereco?: string | null;
    responsavel?: string | null;
  }[];
  // Codigos internos dos EPIs a copiar da origem. Vazio ou ausente copia nenhum.
  episParaCopiar?: string[];
  // Nomes das categorias a copiar. Categoria de EPI copiado entra automaticamente.
  categoriasParaCopiar?: string[];
  // Nomes dos kits a copiar. Kit com item fora da lista de EPIs e ignorado.
  kitsParaCopiar?: string[];
};

function exigir(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor.trim().length === 0) {
    throw new Error(`Campo obrigatorio ausente no JSON: ${campo}`);
  }
  return valor.trim();
}

function soDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) throw new Error("Informe o arquivo de configuracao. Ex.: npx tsx prisma/provisionar-producao.ts prisma/producao.json");
  if (!process.env.ORIGEM_URL) throw new Error("Defina ORIGEM_URL com o banco de onde copiar o cadastro base.");

  const cfg: Config = JSON.parse(fs.readFileSync(path.resolve(arquivo), "utf8"));

  exigir(cfg.empresa?.razaoSocial, "empresa.razaoSocial");
  const cnpj = soDigitos(exigir(cfg.empresa?.cnpj, "empresa.cnpj"));
  if (cnpj.length !== 14) throw new Error(`CNPJ da empresa deve ter 14 digitos, recebi ${cnpj.length}.`);
  if (/^(\d)\1+$/.test(cnpj) || cnpj === "00000000000191") {
    throw new Error("CNPJ parece ser de teste. Informe o CNPJ real da empresa.");
  }
  exigir(cfg.administrador?.nome, "administrador.nome");
  const emailAdmin = exigir(cfg.administrador?.email, "administrador.email").toLowerCase();
  const senhaAdmin = exigir(cfg.administrador?.senhaProvisoria, "administrador.senhaProvisoria");
  if (senhaAdmin.length < 8) throw new Error("A senha provisoria precisa ter ao menos 8 caracteres.");
  if (/demoepi\.com\.br$/i.test(emailAdmin)) {
    throw new Error("O e-mail do administrador ainda e o da demonstracao. Use o e-mail corporativo real.");
  }
  if (!cfg.filiais?.length) throw new Error("Informe ao menos uma filial em 'filiais'.");

  const destino = new PrismaClient();
  const origem = new PrismaClient({ datasources: { db: { url: process.env.ORIGEM_URL } } });

  try {
    // Trava de seguranca: nunca rodar sobre um banco que ja tem dados.
    const jaExiste = await destino.organization.count();
    if (jaExiste > 0) {
      throw new Error(
        `O banco de destino ja tem ${jaExiste} organizacao(oes). Este script so roda em banco vazio, para nao duplicar nem sobrescrever dados.`
      );
    }

    const codigosEpi = cfg.episParaCopiar ?? [];
    const nomesCategoria = cfg.categoriasParaCopiar ?? [];
    const nomesKit = cfg.kitsParaCopiar ?? [];

    // ---- le o cadastro base da origem ----
    const episOrigem = codigosEpi.length
      ? await origem.ppeItem.findMany({
          where: { codigoInterno: { in: codigosEpi } },
          include: { category: { select: { nome: true, descricao: true } } },
        })
      : [];
    const faltando = codigosEpi.filter((c) => !episOrigem.some((e) => e.codigoInterno === c));
    if (faltando.length) throw new Error(`EPIs nao encontrados na origem: ${faltando.join(", ")}`);

    const categoriasOrigem = await origem.ppeCategory.findMany({
      where: { nome: { in: [...new Set([...nomesCategoria, ...episOrigem.map((e) => e.category.nome)])] } },
      select: { nome: true, descricao: true },
      distinct: ["nome"],
    });

    const kitsOrigem = nomesKit.length
      ? await origem.ppeKit.findMany({
          where: { nome: { in: nomesKit } },
          include: { items: { include: { ppeItem: { select: { codigoInterno: true } } } } },
        })
      : [];

    console.log("Vai criar:");
    console.log("  empresa      :", cfg.empresa.razaoSocial, "| CNPJ", cnpj);
    console.log("  administrador:", cfg.administrador.nome, "<" + emailAdmin + ">");
    console.log("  filiais      :", cfg.filiais.map((f) => f.nome).join(", "));
    console.log("  categorias   :", categoriasOrigem.length);
    console.log("  EPIs         :", episOrigem.length);
    console.log("  kits         :", kitsOrigem.length);
    console.log("");

    await destino.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          razaoSocial: cfg.empresa.razaoSocial.trim(),
          nomeFantasia: cfg.empresa.nomeFantasia?.trim() || null,
          cnpj,
          telefone: cfg.empresa.telefone?.trim() || null,
          email: cfg.empresa.email?.trim() || null,
          endereco: cfg.empresa.endereco?.trim() || null,
        },
      });

      await tx.user.create({
        data: {
          organizationId: org.id,
          name: cfg.administrador.nome.trim(),
          email: emailAdmin,
          passwordHash: await bcrypt.hash(senhaAdmin, 12),
          role: "ADMIN",
          // Administrador sem filial enxerga todas (visao corporativa).
          branchId: null,
        },
      });

      for (const f of cfg.filiais) {
        await tx.branch.create({
          data: {
            organizationId: org.id,
            nome: exigir(f.nome, "filiais[].nome"),
            codigo: f.codigo?.trim() || null,
            cnpj: f.cnpj ? soDigitos(f.cnpj) : null,
            uf: f.uf?.trim().toUpperCase() || null,
            cidade: f.cidade?.trim() || null,
            endereco: f.endereco?.trim() || null,
            responsavel: f.responsavel?.trim() || null,
          },
        });
      }

      const idPorCategoria = new Map<string, string>();
      for (const c of categoriasOrigem) {
        const criada = await tx.ppeCategory.create({
          data: { organizationId: org.id, nome: c.nome, descricao: c.descricao },
        });
        idPorCategoria.set(c.nome, criada.id);
      }

      const idPorCodigoEpi = new Map<string, string>();
      for (const e of episOrigem) {
        const criado = await tx.ppeItem.create({
          data: {
            organizationId: org.id,
            nome: e.nome,
            codigoInterno: e.codigoInterno,
            exigeCa: e.exigeCa,
            ca: e.ca,
            caValidade: e.caValidade,
            categoryId: idPorCategoria.get(e.category.nome)!,
            fabricante: e.fabricante,
            modelo: e.modelo,
            unidade: e.unidade,
            vidaUtilDias: e.vidaUtilDias,
            // Padroes do catalogo. O saldo real de cada filial nasce na primeira compra.
            estoqueMinimo: e.estoqueMinimo,
            estoqueMaximo: e.estoqueMaximo,
            custoUnitario: e.custoUnitario,
            descricao: e.descricao,
          },
        });
        idPorCodigoEpi.set(e.codigoInterno, criado.id);
      }

      for (const k of kitsOrigem) {
        const itens = k.items.filter((i) => idPorCodigoEpi.has(i.ppeItem.codigoInterno));
        if (itens.length !== k.items.length) {
          console.log(`  aviso: kit "${k.nome}" tem item fora da lista de EPIs copiados e foi ignorado.`);
          continue;
        }
        await tx.ppeKit.create({
          data: {
            organizationId: org.id,
            nome: k.nome,
            descricao: k.descricao,
            items: {
              create: itens.map((i) => ({
                ppeItemId: idPorCodigoEpi.get(i.ppeItem.codigoInterno)!,
                quantidade: i.quantidade,
              })),
            },
          },
        });
      }
    });

    // ---- confere o que entrou ----
    const contagem = {
      organizacoes: await destino.organization.count(),
      usuarios: await destino.user.count(),
      filiais: await destino.branch.count(),
      categorias: await destino.ppeCategory.count(),
      epis: await destino.ppeItem.count(),
      kits: await destino.ppeKit.count(),
      colaboradores: await destino.employee.count(),
      estoque: await destino.branchStock.count(),
      entregas: await destino.delivery.count(),
      compras: await destino.purchase.count(),
      devolucoes: await destino.ppeReturn.count(),
      cobrancas: await destino.employeeCharge.count(),
      movimentacoes: await destino.stockMovement.count(),
      alertas: await destino.alert.count(),
      auditoria: await destino.auditLog.count(),
    };
    console.log("Resultado:");
    for (const [k, v] of Object.entries(contagem)) console.log("  " + k.padEnd(16) + v);
    console.log("");
    console.log("Pronto. Entre com", emailAdmin, "e troque a senha no primeiro acesso.");
  } finally {
    await destino.$disconnect();
    await origem.$disconnect();
  }
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
