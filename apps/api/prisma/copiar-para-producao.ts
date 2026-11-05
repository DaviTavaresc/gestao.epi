// Copia o cadastro ja conferido do banco de origem para um banco de producao vazio.
//
// Por que copiar em vez de provisionar e importar de novo: o banco de origem passou
// pela limpeza dos dados de teste e pela reconciliacao contra a planilha do RH, e
// ficou com os 161 colaboradores reais, os 63 cargos e os 18 setores que a planilha
// usa. Reimportar exigiria recriar cargo e setor na mao antes, porque a importacao
// reprova linha com cargo inexistente - e qualquer divergencia de acento ou espaco
// nessa recriacao reprovaria pessoas em silencio.
//
// Os ids sao preservados. Isso mantem as chaves estrangeiras validas sem precisar
// de tabela de traducao, que e onde um script de copia normalmente erra.
//
// Nao copia usuario: a senha de producao nao sai de um banco de desenvolvimento.
// Nao copia movimento (entrega, estoque, compra, devolucao, cobranca, auditoria):
// producao comeca sem historico, e na origem isso esta zerado de qualquer forma.
//
// Uso:
//   ORIGEM_URL=<banco local> DESTINO_URL=<banco de producao> \
//     npx tsx prisma/copiar-para-producao.ts [--aplicar]
import { PrismaClient } from "@prisma/client";

const origemUrl = process.env.ORIGEM_URL;
const destinoUrl = process.env.DESTINO_URL;
if (!origemUrl) throw new Error("Defina ORIGEM_URL com o banco de onde copiar.");
if (!destinoUrl) throw new Error("Defina DESTINO_URL com o banco de producao.");
if (origemUrl === destinoUrl) throw new Error("ORIGEM_URL e DESTINO_URL sao o mesmo banco.");

const aplicar = process.argv.includes("--aplicar");
const origem = new PrismaClient({ datasources: { db: { url: origemUrl } } });
const destino = new PrismaClient({ datasources: { db: { url: destinoUrl } } });

// A ordem e a das dependencias: cada tabela so entra depois daquelas que ela
// referencia. Inverter duas linhas aqui quebra a chave estrangeira.
const ORDEM = [
  "organization",
  "branch",
  "position",
  "department",
  "ppeCategory",
  "ppeItem",
  "ppeKit",
  "ppeKitItem",
  "employee",
  "positionPpeRequirement",
] as const;

async function main() {
  // Trava: nunca rodar sobre banco que ja tem dados, para nao duplicar cadastro.
  const jaTem = await destino.organization.count();
  if (jaTem > 0) {
    throw new Error(`O destino ja tem ${jaTem} organizacao(oes). Este script so roda em banco vazio.`);
  }

  const dados: Record<string, any[]> = {};
  for (const modelo of ORDEM) {
    dados[modelo] = await (origem as any)[modelo].findMany();
  }

  console.log(aplicar ? "Copiando:" : "SIMULACAO - copiaria:");
  for (const modelo of ORDEM) console.log("  " + modelo.padEnd(24) + dados[modelo].length);

  const usuariosOrigem = await origem.user.count();
  console.log(`\nusuario: ${usuariosOrigem} na origem, 0 copiado (a senha nao sai do banco de desenvolvimento)`);

  if (!aplicar) {
    console.log("\nRode com --aplicar para gravar.");
    return;
  }

  // Tudo numa transacao: um cadastro pela metade e pior que nenhum, porque
  // parece completo na tela e so falha quando alguem tenta entregar um EPI.
  await destino.$transaction(
    async (tx) => {
      for (const modelo of ORDEM) {
        const linhas = dados[modelo];
        if (!linhas.length) continue;
        await (tx as any)[modelo].createMany({ data: linhas });
      }
    },
    { timeout: 180000 }
  );

  console.log("\nGravado. Conferindo no destino:");
  for (const modelo of ORDEM) {
    const n = await (destino as any)[modelo].count();
    const esperado = dados[modelo].length;
    console.log(`  ${modelo.padEnd(24)}${String(n).padStart(4)}  ${n === esperado ? "ok" : `DIVERGENTE (esperado ${esperado})`}`);
  }
}

main()
  .catch((e) => { console.error("FALHOU:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await origem.$disconnect(); await destino.$disconnect(); });
