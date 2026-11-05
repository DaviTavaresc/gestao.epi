// Carrega no banco o catalogo de EPI e a matriz Cargo x EPI extraidos dos PGRs
// (prisma/dados/epis-pgr.json): categorias, EPIs, kits e a exigencia por cargo.
//
// Uso:
//   npx tsx prisma/carregar-epis-pgr.ts                  # so confere e relata
//   npx tsx prisma/carregar-epis-pgr.ts --aplicar        # grava
//   ... --org <cnpj|id>                                  # escolhe a empresa
//
// Sem --aplicar nada e gravado: o padrao e conferencia, porque a matriz define
// o que cada pessoa vai receber e um erro aqui entrega o EPI que nao protege.
//
// Rodar de novo nao duplica: tudo e upsert por chave de negocio
// (codigoInterno do EPI, nome da categoria/kit, par cargo+EPI).
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

type ItemCatalogo = {
  codigoInterno: string;
  nome: string;
  categoria: string;
  ca: string | null;
  exigeCa: boolean;
  unidade: string;
  vidaUtilDiasProposta: number;
  observacao?: string;
};

type Base = {
  catalogo: ItemCatalogo[];
  kits: { nome: string; itens: string[]; fonte: string }[];
  cargosPorKit: Record<string, string[]>;
  lacunas: string[];
};

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const alvoOrg = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;

const arquivo = path.join(__dirname, "dados", "epis-pgr.json");

// O nome do cargo pode divergir por acento ou espaco duplicado entre o PGR e a folha.
// Comparar normalizado evita tratar como ausente um cargo que existe escrito diferente.
const chaveCargo = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

async function resolverOrganizacao() {
  if (alvoOrg) {
    const porId = await prisma.organization.findUnique({ where: { id: alvoOrg } });
    if (porId) return porId;
    const soDigitos = alvoOrg.replace(/\D/g, "");
    const todas = await prisma.organization.findMany();
    const porCnpj = todas.find((o) => o.cnpj.replace(/\D/g, "") === soDigitos);
    if (porCnpj) return porCnpj;
    throw new Error(`Nenhuma empresa encontrada para --org ${alvoOrg}.`);
  }
  const todas = await prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
  if (todas.length === 0) throw new Error("Banco sem empresa cadastrada. Rode o provisionamento primeiro.");
  if (todas.length > 1) {
    throw new Error(
      `O banco tem ${todas.length} empresas. Informe qual com --org <cnpj|id>:\n` +
        todas.map((o) => `  ${o.cnpj}  ${o.razaoSocial}  (${o.id})`).join("\n"),
    );
  }
  return todas[0];
}

async function main() {
  const base: Base = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  const org = await resolverOrganizacao();
  console.log(`empresa: ${org.razaoSocial} (${org.cnpj})`);
  console.log(aplicar ? "modo: APLICAR\n" : "modo: conferencia (nada sera gravado)\n");

  // --- conferencias que impedem a gravacao ---
  const problemas: string[] = [];

  const porCodigo = new Map(base.catalogo.map((i) => [i.codigoInterno, i]));
  for (const kit of base.kits) {
    for (const codigo of kit.itens) {
      if (!porCodigo.has(codigo)) problemas.push(`Kit "${kit.nome}" cita o item inexistente ${codigo}.`);
    }
  }
  for (const nomeKit of Object.keys(base.cargosPorKit)) {
    if (!base.kits.some((k) => k.nome === nomeKit)) {
      problemas.push(`cargosPorKit cita o kit inexistente "${nomeKit}".`);
    }
  }

  // Os cargos tem de existir na folha. Criar cargo aqui a partir de um nome do PGR
  // produziria um cargo paralelo, sem ninguem dentro, e a exigencia nao chegaria a ninguem.
  const cargosBanco = await prisma.position.findMany({ where: { organizationId: org.id } });
  const indiceCargo = new Map<string, { id: string; nome: string }>();
  for (const c of cargosBanco) indiceCargo.set(chaveCargo(c.nome), c);

  const cargosUsados = [...new Set(Object.values(base.cargosPorKit).flat())];
  for (const c of cargosUsados.filter((c) => !indiceCargo.has(chaveCargo(c)))) {
    problemas.push(`Cargo "${c}" nao existe no banco desta empresa.`);
  }

  const vistos = new Map<string, string>();
  for (const [kit, cargos] of Object.entries(base.cargosPorKit)) {
    for (const c of cargos) {
      const k = chaveCargo(c);
      if (vistos.has(k)) problemas.push(`Cargo "${c}" aparece em dois kits: ${vistos.get(k)} e ${kit}.`);
      else vistos.set(k, kit);
    }
  }

  if (problemas.length > 0) {
    console.log("-- problemas encontrados --");
    problemas.forEach((p) => console.log(`  ${p}`));
    console.log("\nNada foi gravado. Corrija o JSON (ou o cadastro de cargos) e rode de novo.");
    process.exitCode = 1;
    return;
  }
  console.log("conferencia: ok (itens, kits e cargos conferem)\n");

  const categorias = [...new Set(base.catalogo.map((i) => i.categoria))].sort();
  const totalExigencias = Object.entries(base.cargosPorKit).reduce(
    (soma, [kit, cargos]) => soma + cargos.length * base.kits.find((k) => k.nome === kit)!.itens.length,
    0,
  );

  if (!aplicar) {
    console.log("seria gravado:");
    console.log(`  ${categorias.length} categorias: ${categorias.join(", ")}`);
    console.log(`  ${base.catalogo.length} EPIs`);
    console.log(`  ${base.kits.length} kits`);
    for (const kit of base.kits) {
      const cargos = base.cargosPorKit[kit.nome] ?? [];
      console.log(`    ${kit.nome}: ${kit.itens.length} itens x ${cargos.length} cargos`);
    }
    console.log(`  ${totalExigencias} exigencias cargo x EPI`);
    console.log("\nrode com --aplicar para gravar.");
    if (base.lacunas.length > 0) {
      console.log("\n-- lacunas registradas no JSON --");
      base.lacunas.forEach((l) => console.log(`  - ${l}`));
    }
    return;
  }

  // Uma transacao unica: ou a matriz inteira entra, ou nada entra. Meia matriz
  // gravada e pior que nenhuma, porque parece completa na tela.
  const resumo = await prisma.$transaction(
    async (tx) => {
      const idCategoria = new Map<string, string>();
      for (const nome of categorias) {
        const cat = await tx.ppeCategory.upsert({
          where: { organizationId_nome: { organizationId: org.id, nome } },
          update: {},
          create: { organizationId: org.id, nome, descricao: "Categoria citada nos PGRs de 2026." },
        });
        idCategoria.set(nome, cat.id);
      }

      const idItem = new Map<string, string>();
      for (const item of base.catalogo) {
        const dados = {
          nome: item.nome,
          categoryId: idCategoria.get(item.categoria)!,
          exigeCa: item.exigeCa,
          ca: item.ca,
          unidade: item.unidade,
          vidaUtilDias: item.vidaUtilDiasProposta,
          descricao: item.observacao ?? null,
        };
        const salvo = await tx.ppeItem.upsert({
          where: { organizationId_codigoInterno: { organizationId: org.id, codigoInterno: item.codigoInterno } },
          // caValidade, fabricante, modelo, custo e estoque nao vem do PGR: quem ja
          // preencheu esses campos no sistema nao perde o dado numa nova carga.
          update: dados,
          create: { organizationId: org.id, codigoInterno: item.codigoInterno, ...dados },
        });
        idItem.set(item.codigoInterno, salvo.id);
      }

      let itensDeKit = 0;
      for (const kit of base.kits) {
        const salvo = await tx.ppeKit.upsert({
          where: { organizationId_nome: { organizationId: org.id, nome: kit.nome } },
          update: { descricao: kit.fonte },
          create: { organizationId: org.id, nome: kit.nome, descricao: kit.fonte },
        });
        for (const codigo of kit.itens) {
          await tx.ppeKitItem.upsert({
            where: { kitId_ppeItemId: { kitId: salvo.id, ppeItemId: idItem.get(codigo)! } },
            update: { quantidade: 1 },
            create: { kitId: salvo.id, ppeItemId: idItem.get(codigo)!, quantidade: 1 },
          });
          itensDeKit++;
        }
      }

      let exigencias = 0;
      for (const [nomeKit, cargos] of Object.entries(base.cargosPorKit)) {
        const kit = base.kits.find((k) => k.nome === nomeKit)!;
        for (const nomeCargo of cargos) {
          const cargo = indiceCargo.get(chaveCargo(nomeCargo))!;
          for (const codigo of kit.itens) {
            await tx.positionPpeRequirement.upsert({
              where: { positionId_ppeItemId: { positionId: cargo.id, ppeItemId: idItem.get(codigo)! } },
              update: { quantidade: 1 },
              create: {
                organizationId: org.id,
                positionId: cargo.id,
                ppeItemId: idItem.get(codigo)!,
                quantidade: 1,
              },
            });
            exigencias++;
          }
        }
      }

      return { categorias: idCategoria.size, itens: idItem.size, kits: base.kits.length, itensDeKit, exigencias };
    },
    { timeout: 120000 },
  );

  console.log("gravado:");
  console.log(`  categorias: ${resumo.categorias}`);
  console.log(`  EPIs: ${resumo.itens}`);
  console.log(`  kits: ${resumo.kits} (${resumo.itensDeKit} itens de kit)`);
  console.log(`  exigencias cargo x EPI: ${resumo.exigencias}`);
  console.log("\nFalta definir, fora deste carregamento:");
  console.log("  - caValidade de cada CA (o sistema bloqueia entrega com CA vencido)");
  console.log("  - aval do tecnico de seguranca sobre a vida util proposta");
  console.log("  - estoque minimo/maximo e custo por filial (BranchStock)");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
