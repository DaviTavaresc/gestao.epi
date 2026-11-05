// Remove dos bancos de desenvolvimento os dados de demonstracao e de teste, deixando
// so o que e real: a empresa, as pessoas da planilha do RH, as filiais onde elas
// trabalham e tem contrato, e o catalogo de EPI vindo dos PGRs.
//
// Uso:
//   npx tsx prisma/limpar-dados-de-teste.ts --planilha <arquivo.xlsx> --org <cnpj|id>
//   ... --aplicar              # executa
//   ... --usuarios a@b,c@d     # quais logins preservar (padrao: o ADMIN mais antigo)
//   ... --apagar-movimento     # autoriza apagar entrega/cobranca/devolucao de pessoa real
//
// Sem --aplicar nada e apagado. FACA BACKUP ANTES (pg_dump): isto apaga de verdade.
//
// Quem e real nao e adivinhado por padrao de nome: a lista de CPFs da planilha do RH
// e a fonte da verdade. Tudo que nao esta nela, ou nao e alcancado por ela, sai.
// Alem de apagar, o script reconcilia quem fica com o que a planilha diz, porque um
// registro criado a mao durante os testes pode ter bloqueado a linha real na
// importacao (CPF ja existia) e ficado com nome e matricula de teste.
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const valor = (nome: string) => (args.includes(nome) ? args[args.indexOf(nome) + 1] : null);
const aplicar = args.includes("--aplicar");
const apagarMovimento = args.includes("--apagar-movimento");
const caminhoPlanilha = valor("--planilha");
const alvoOrg = valor("--org");
const usuariosManter = (valor("--usuarios") ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

const soDigitos = (s: string) => s.replace(/\D/g, "");
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

type LinhaPlanilha = {
  nomeCompleto: string;
  cpf: string;
  matricula: string;
  filial: string;
  filialContrato: string;
  cargo: string;
  setor: string;
  dataAdmissao: Date | null;
};

// A data vem as vezes como Date do Excel, as vezes como texto dd/mm/aaaa.
function lerData(v: unknown): Date | null {
  if (v instanceof Date) return v;
  const s = String((v as { text?: string })?.text ?? v ?? "").trim();
  if (!s) return null;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(Date.UTC(+br[3], +br[2] - 1, +br[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function lerPlanilha(caminho: string) {
  const texto = (v: unknown) => String((v as { text?: string })?.text ?? v ?? "").trim();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  for (const ws of wb.worksheets) {
    const cab: string[] = [];
    ws.getRow(1).eachCell((c, i) => (cab[i] = texto(c.value)));
    const col = (n: string) => cab.findIndex((h) => h === n);
    if (col("cpf") < 0) continue;
    const linhas = new Map<string, LinhaPlanilha>();
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cpf = soDigitos(texto(row.getCell(col("cpf")).value));
      if (!cpf) continue;
      linhas.set(cpf, {
        nomeCompleto: texto(row.getCell(col("nomeCompleto")).value),
        cpf,
        matricula: texto(row.getCell(col("matricula")).value),
        filial: texto(row.getCell(col("filial")).value),
        filialContrato: texto(row.getCell(col("filialContrato")).value),
        cargo: texto(row.getCell(col("cargo")).value),
        setor: texto(row.getCell(col("setor")).value),
        dataAdmissao: lerData(row.getCell(col("dataAdmissao")).value),
      });
    }
    return linhas;
  }
  throw new Error(`Nenhuma aba de ${caminho} tem coluna "cpf".`);
}

async function resolverOrganizacao() {
  const todas = await prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
  if (!alvoOrg) {
    if (todas.length === 1) return todas[0];
    throw new Error(
      `Informe a empresa real com --org <cnpj|id>. Existem ${todas.length}:\n` +
        todas.map((o) => `  ${o.cnpj}  ${o.razaoSocial}  (${o.id})`).join("\n"),
    );
  }
  const achada = todas.find((o) => o.id === alvoOrg || soDigitos(o.cnpj) === soDigitos(alvoOrg));
  if (!achada) throw new Error(`Nenhuma empresa para --org ${alvoOrg}.`);
  return achada;
}

async function main() {
  if (!caminhoPlanilha) throw new Error("Falta --planilha <arquivo.xlsx> com a lista real de colaboradores.");
  const org = await resolverOrganizacao();
  const planilha = await lerPlanilha(caminhoPlanilha);
  console.log(`empresa real: ${org.razaoSocial} (${org.cnpj})`);
  console.log(`planilha: ${path.basename(caminhoPlanilha)} -> ${planilha.size} pessoas`);
  console.log(aplicar ? "modo: APLICAR\n" : "modo: simulacao (nada sera apagado)\n");

  const filiais = await prisma.branch.findMany({ where: { organizationId: org.id }, select: { id: true, nome: true } });
  const cargos = await prisma.position.findMany({ where: { organizationId: org.id }, select: { id: true, nome: true } });
  const setores = await prisma.department.findMany({ where: { organizationId: org.id }, select: { id: true, nome: true } });
  const porNome = <T extends { id: string; nome: string }>(lista: T[]) => {
    const m = new Map<string, T>();
    for (const x of lista) m.set(norm(x.nome), x);
    return m;
  };
  const idxFilial = porNome(filiais);
  const idxCargo = porNome(cargos);
  const idxSetor = porNome(setores);

  const funcionarios = await prisma.employee.findMany({
    where: { organizationId: org.id },
    select: {
      id: true, cpf: true, nomeCompleto: true, matricula: true, dataAdmissao: true,
      branchId: true, contractBranchId: true, positionId: true, departmentId: true,
    },
  });
  const ficamFunc = funcionarios.filter((f) => planilha.has(soDigitos(f.cpf)));
  const saemFunc = funcionarios.filter((f) => !planilha.has(soDigitos(f.cpf)));

  const faltamNoBanco = [...planilha.values()].filter((p) => !funcionarios.some((f) => soDigitos(f.cpf) === p.cpf));
  if (faltamNoBanco.length > 0) {
    console.log(`aviso: ${faltamNoBanco.length} pessoas da planilha nao estao no banco (este script nao cria):`);
    faltamNoBanco.slice(0, 10).forEach((p) => console.log(`  ${p.cpf}  ${p.nomeCompleto}`));
  }

  // ---------- reconciliacao: alinhar quem fica com a planilha ----------
  const problemas: string[] = [];
  type Correcao = { id: string; cpf: string; de: string; para: string; dados: Prisma.EmployeeUpdateInput };
  const correcoes: Correcao[] = [];
  // Estado efetivo depois da correcao: e dele que saem os conjuntos do que fica,
  // senao o script apagaria o cargo ou a filial que a correcao vai passar a usar.
  const efetivo = new Map<string, { branchId: string | null; contractBranchId: string | null; positionId: string | null; departmentId: string | null }>();

  for (const f of ficamFunc) {
    const p = planilha.get(soDigitos(f.cpf))!;
    const alvoCargo = p.cargo ? idxCargo.get(norm(p.cargo)) : undefined;
    const alvoSetor = p.setor ? idxSetor.get(norm(p.setor)) : undefined;
    const alvoFilial = p.filial ? idxFilial.get(norm(p.filial)) : undefined;
    const alvoContrato = p.filialContrato ? idxFilial.get(norm(p.filialContrato)) : undefined;
    if (p.cargo && !alvoCargo) problemas.push(`Cargo "${p.cargo}" (CPF ${p.cpf}) nao existe no banco.`);
    if (p.setor && !alvoSetor) problemas.push(`Setor "${p.setor}" (CPF ${p.cpf}) nao existe no banco.`);
    if (p.filial && !alvoFilial) problemas.push(`Filial "${p.filial}" (CPF ${p.cpf}) nao existe no banco.`);
    if (p.filialContrato && !alvoContrato) problemas.push(`Filial de contrato "${p.filialContrato}" (CPF ${p.cpf}) nao existe no banco.`);

    const novo = {
      // A planilha do RH nao preenche a coluna "filial": a importacao usou a empresa
      // do contrato como filial de trabalho, e e dela que sai o estoque da entrega.
      // Repetir a mesma regra aqui evita zerar a lotacao de quem ja esta certo.
      branchId: alvoFilial?.id ?? alvoContrato?.id ?? null,
      contractBranchId: alvoContrato?.id ?? null,
      // Celula vazia na planilha e falta de informacao, nao ordem de limpar o campo.
      positionId: p.cargo ? alvoCargo?.id ?? null : f.positionId,
      departmentId: p.setor ? alvoSetor?.id ?? null : f.departmentId,
    };
    efetivo.set(f.id, novo);

    const dados: Prisma.EmployeeUpdateInput = {};
    const diffs: string[] = [];
    if (norm(f.nomeCompleto) !== norm(p.nomeCompleto)) {
      dados.nomeCompleto = p.nomeCompleto;
      diffs.push(`nome "${f.nomeCompleto}" -> "${p.nomeCompleto}"`);
    }
    if (p.matricula && f.matricula !== p.matricula) {
      dados.matricula = p.matricula;
      diffs.push(`matricula ${f.matricula} -> ${p.matricula}`);
    }
    if (f.positionId !== novo.positionId) {
      dados.position = novo.positionId ? { connect: { id: novo.positionId } } : { disconnect: true };
      diffs.push(`cargo -> ${p.cargo || "(nenhum)"}`);
    }
    if (f.departmentId !== novo.departmentId) {
      dados.department = novo.departmentId ? { connect: { id: novo.departmentId } } : { disconnect: true };
      diffs.push(`setor -> ${p.setor || "(nenhum)"}`);
    }
    if (f.branchId !== novo.branchId) {
      dados.branch = novo.branchId ? { connect: { id: novo.branchId } } : { disconnect: true };
      const nomeFilialNova = filiais.find((b) => b.id === novo.branchId)?.nome;
      diffs.push(`filial de trabalho -> ${nomeFilialNova ?? "(nenhuma)"}${p.filial ? "" : " (herdada do contrato)"}`);
    }
    if (f.contractBranchId !== novo.contractBranchId) {
      dados.contractBranch = novo.contractBranchId ? { connect: { id: novo.contractBranchId } } : { disconnect: true };
      diffs.push(`contrato -> ${p.filialContrato || "(nenhum)"}`);
    }
    if (p.dataAdmissao && p.dataAdmissao.toISOString().slice(0, 10) !== f.dataAdmissao.toISOString().slice(0, 10)) {
      dados.dataAdmissao = p.dataAdmissao;
      diffs.push(`admissao ${f.dataAdmissao.toISOString().slice(0, 10)} -> ${p.dataAdmissao.toISOString().slice(0, 10)}`);
    }
    if (Object.keys(dados).length > 0) correcoes.push({ id: f.id, cpf: f.cpf, de: f.nomeCompleto, para: p.nomeCompleto, dados });
    if (diffs.length > 0 && Object.keys(dados).length > 0) {
      (correcoes[correcoes.length - 1] as Correcao & { diffs?: string[] }).diffs = diffs;
    }
  }

  if (problemas.length > 0) {
    console.log("\n-- nomes da planilha que nao existem no banco --");
    [...new Set(problemas)].forEach((p) => console.log(`  ${p}`));
    console.log("\nPARADO: corrija o cadastro (ou a planilha) antes. O script nao cria cargo/setor/filial.");
    process.exitCode = 1;
    return;
  }

  // ---------- conjuntos do que fica, a partir do estado efetivo ----------
  const idsFicamFunc = new Set(ficamFunc.map((f) => f.id));
  const idsFicamFilial = new Set<string>();
  const idsFicamCargo = new Set<string>();
  const idsFicamSetor = new Set<string>();
  for (const f of ficamFunc) {
    const e = efetivo.get(f.id)!;
    if (e.branchId) idsFicamFilial.add(e.branchId);
    if (e.contractBranchId) idsFicamFilial.add(e.contractBranchId);
    if (e.positionId) idsFicamCargo.add(e.positionId);
    if (e.departmentId) idsFicamSetor.add(e.departmentId);
  }

  const base = JSON.parse(fs.readFileSync(path.join(__dirname, "dados", "epis-pgr.json"), "utf8"));
  const codigosReais: string[] = base.catalogo.map((i: { codigoInterno: string }) => i.codigoInterno);
  const nomesKitsReais: string[] = base.kits.map((k: { nome: string }) => k.nome);
  // Cargo citado na matriz do PGR fica mesmo sem ninguem dentro hoje: a exigencia de
  // EPI ja esta gravada nele, e apagar o cargo levaria a exigencia junto.
  for (const nome of Object.values(base.cargosPorKit).flat() as string[]) {
    const c = idxCargo.get(norm(nome));
    if (c) idsFicamCargo.add(c.id);
  }

  const itens = await prisma.ppeItem.findMany({ where: { organizationId: org.id }, select: { id: true, codigoInterno: true, nome: true, categoryId: true } });
  const idsFicamItem = new Set(itens.filter((i) => codigosReais.includes(i.codigoInterno)).map((i) => i.id));
  const idsFicamCategoria = new Set(itens.filter((i) => idsFicamItem.has(i.id)).map((i) => i.categoryId));
  const kits = await prisma.ppeKit.findMany({ where: { organizationId: org.id }, select: { id: true, nome: true } });
  const idsFicamKit = new Set(kits.filter((k) => nomesKitsReais.includes(k.nome)).map((k) => k.id));
  const categorias = await prisma.ppeCategory.findMany({ where: { organizationId: org.id }, select: { id: true, nome: true } });

  const usuarios = await prisma.user.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, branchId: true },
  });
  let ficamUsuarios = usuarios.filter((u) => usuariosManter.includes(u.email.toLowerCase()));
  if (ficamUsuarios.length === 0) {
    const admin = usuarios.find((u) => u.role === "ADMIN");
    if (!admin) throw new Error("Nenhum usuario ADMIN para preservar. Passe --usuarios <email>.");
    ficamUsuarios = [admin];
    console.log(`nenhum --usuarios informado: preservando o ADMIN mais antigo, ${admin.email}`);
  }
  const idsFicamUsuario = new Set(ficamUsuarios.map((u) => u.id));

  // ---------- movimento ligado a gente real ----------
  const entregasReais = await prisma.delivery.findMany({
    where: { employeeId: { in: [...idsFicamFunc] } },
    select: { id: true, createdAt: true, status: true, employee: { select: { nomeCompleto: true, cpf: true } } },
  });
  const cobrancasReais = await prisma.employeeCharge.count({ where: { employeeId: { in: [...idsFicamFunc] } } });
  const devolucoesReais = await prisma.ppeReturn.count({ where: { employeeId: { in: [...idsFicamFunc] } } });
  const temMovimentoReal = entregasReais.length + cobrancasReais + devolucoesReais > 0;

  if (temMovimentoReal) {
    console.log(
      `\natencao: pessoas da planilha tem movimento registrado ` +
        `(entregas=${entregasReais.length} cobrancas=${cobrancasReais} devolucoes=${devolucoesReais}):`,
    );
    for (const e of entregasReais.slice(0, 20)) {
      console.log(`  ${e.createdAt.toISOString().slice(0, 10)} ${e.status.padEnd(12)} ${e.employee.cpf}  ${e.employee.nomeCompleto}`);
    }
    if (!apagarMovimento) {
      console.log(
        `\nPARADO: isto pode ser historico de entrega de EPI, que nao se apaga por conta.\n` +
          `Se for movimento de teste, rode de novo com --apagar-movimento.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log("  --apagar-movimento informado: este movimento sera apagado.");
  }

  // ---------- relatorio ----------
  const outrasOrgs = await prisma.organization.findMany({ where: { id: { not: org.id } }, select: { id: true, razaoSocial: true } });
  const linha = (rotulo: string, fica: number, sai: number) =>
    console.log(`  ${rotulo.padEnd(14)} fica ${String(fica).padStart(4)}   sai ${String(sai).padStart(4)}`);
  console.log("\ndentro da empresa real:");
  linha("colaboradores", ficamFunc.length, saemFunc.length);
  linha("filiais", idsFicamFilial.size, filiais.length - idsFicamFilial.size);
  linha("cargos", idsFicamCargo.size, cargos.length - idsFicamCargo.size);
  linha("setores", idsFicamSetor.size, setores.length - idsFicamSetor.size);
  linha("EPIs", idsFicamItem.size, itens.length - idsFicamItem.size);
  linha("kits", idsFicamKit.size, kits.length - idsFicamKit.size);
  linha("categorias", idsFicamCategoria.size, categorias.length - idsFicamCategoria.size);
  linha("usuarios", idsFicamUsuario.size, usuarios.length - idsFicamUsuario.size);
  console.log(`\noutras empresas (apagadas inteiras): ${outrasOrgs.length}`);
  console.log(`correcoes a aplicar em quem fica: ${correcoes.length}`);
  for (const c of correcoes) {
    console.log(`  CPF ${c.cpf}  ${c.de}`);
    for (const d of (c as Correcao & { diffs?: string[] }).diffs ?? []) console.log(`    ${d}`);
  }
  console.log(
    `\noperacional apagado por inteiro: entregas, confirmacoes, devolucoes, cobrancas,\n` +
      `  movimentos de estoque, estoque por filial, compras, fornecedores, documentos,\n` +
      `  alertas, notificacoes e auditoria.`,
  );

  if (!aplicar) {
    console.log("\n-- filiais que saem --");
    filiais.filter((b) => !idsFicamFilial.has(b.id)).forEach((b) => console.log(`  ${b.nome}`));
    console.log("\n-- EPIs que ficam --");
    itens.filter((i) => idsFicamItem.has(i.id)).forEach((i) => console.log(`  ${i.codigoInterno}  ${i.nome}`));
    console.log(`\n-- amostra de colaboradores que saem (10 de ${saemFunc.length}) --`);
    saemFunc.slice(0, 10).forEach((f) => console.log(`  ${f.cpf.padEnd(16)} ${f.nomeCompleto}`));
    console.log("\nrode com --aplicar para apagar. FACA pg_dump ANTES.");
    return;
  }

  // ---------- execucao ----------
  const idsSaemFunc = saemFunc.map((f) => f.id);
  const idsSaemItem = itens.filter((i) => !idsFicamItem.has(i.id)).map((i) => i.id);
  const idsSaemKit = kits.filter((k) => !idsFicamKit.has(k.id)).map((k) => k.id);
  const idsSaemCargo = cargos.filter((c) => !idsFicamCargo.has(c.id)).map((c) => c.id);
  const idsSaemSetor = setores.filter((d) => !idsFicamSetor.has(d.id)).map((d) => d.id);
  const idsSaemCategoria = categorias.filter((c) => !idsFicamCategoria.has(c.id)).map((c) => c.id);
  const idsSaemFilial = filiais.filter((b) => !idsFicamFilial.has(b.id)).map((b) => b.id);
  const idsSaemUsuario = usuarios.filter((u) => !idsFicamUsuario.has(u.id)).map((u) => u.id);
  const idsSaemOrg = outrasOrgs.map((o) => o.id);

  const contagens: Record<string, number> = {};
  const reg = (k: string, r: { count: number }) => (contagens[k] = (contagens[k] ?? 0) + r.count);

  await prisma.$transaction(
    async (tx) => {
      // A correcao vem antes da remocao: ela pode mover alguem para um cargo ou filial
      // que so sobrevive por causa dela, e os conjuntos ja foram calculados assim.
      for (const c of correcoes) await tx.employee.update({ where: { id: c.id }, data: c.dados });
      contagens["colaboradores corrigidos"] = correcoes.length;

      // Um usuario preservado pode estar lotado numa filial que vai sair: solta o
      // vinculo antes, senao a chave estrangeira impede a remocao da filial.
      await tx.user.updateMany({
        where: { id: { in: [...idsFicamUsuario] }, branchId: { in: idsSaemFilial } },
        data: { branchId: null },
      });

      reg("confirmacoes", await tx.electronicConfirmation.deleteMany({}));
      reg("itens de entrega", await tx.deliveryItem.deleteMany({}));
      reg("entregas", await tx.delivery.deleteMany({}));
      reg("devolucoes", await tx.ppeReturn.deleteMany({}));
      reg("cobrancas", await tx.employeeCharge.deleteMany({}));
      reg("movimentos", await tx.stockMovement.deleteMany({}));
      reg("estoque", await tx.branchStock.deleteMany({}));
      reg("documentos", await tx.document.deleteMany({}));
      reg("itens de compra", await tx.purchaseItem.deleteMany({}));
      reg("compras", await tx.purchase.deleteMany({}));
      reg("fornecedores", await tx.supplier.deleteMany({}));
      reg("alertas", await tx.alert.deleteMany({}));
      reg("notificacoes", await tx.notification.deleteMany({}));
      reg("auditoria", await tx.auditLog.deleteMany({}));

      // A exigencia cargo x EPI so sai quando o cargo ou o EPI dela sai.
      reg("exigencias", await tx.positionPpeRequirement.deleteMany({
        where: { OR: [{ positionId: { in: idsSaemCargo } }, { ppeItemId: { in: idsSaemItem } }, { organizationId: { in: idsSaemOrg } }] },
      }));
      reg("itens de kit", await tx.ppeKitItem.deleteMany({
        where: { OR: [{ kitId: { in: idsSaemKit } }, { ppeItemId: { in: idsSaemItem } }] },
      }));
      reg("kits", await tx.ppeKit.deleteMany({ where: { OR: [{ id: { in: idsSaemKit } }, { organizationId: { in: idsSaemOrg } }] } }));
      reg("EPIs", await tx.ppeItem.deleteMany({ where: { OR: [{ id: { in: idsSaemItem } }, { organizationId: { in: idsSaemOrg } }] } }));
      reg("categorias", await tx.ppeCategory.deleteMany({ where: { OR: [{ id: { in: idsSaemCategoria } }, { organizationId: { in: idsSaemOrg } }] } }));
      reg("colaboradores", await tx.employee.deleteMany({ where: { OR: [{ id: { in: idsSaemFunc } }, { organizationId: { in: idsSaemOrg } }] } }));
      reg("cargos", await tx.position.deleteMany({ where: { OR: [{ id: { in: idsSaemCargo } }, { organizationId: { in: idsSaemOrg } }] } }));
      reg("setores", await tx.department.deleteMany({ where: { OR: [{ id: { in: idsSaemSetor } }, { organizationId: { in: idsSaemOrg } }] } }));

      const saindo = { in: idsSaemUsuario };
      reg("tokens", await tx.refreshToken.deleteMany({ where: { OR: [{ userId: saindo }, { user: { organizationId: { in: idsSaemOrg } } }] } }));
      reg("tokens de senha", await tx.passwordResetToken.deleteMany({ where: { OR: [{ userId: saindo }, { user: { organizationId: { in: idsSaemOrg } } }] } }));
      reg("usuarios", await tx.user.deleteMany({ where: { OR: [{ id: saindo }, { organizationId: { in: idsSaemOrg } }] } }));
      reg("filiais", await tx.branch.deleteMany({ where: { OR: [{ id: { in: idsSaemFilial } }, { organizationId: { in: idsSaemOrg } }] } }));
      reg("empresas", await tx.organization.deleteMany({ where: { id: { in: idsSaemOrg } } }));
    },
    { timeout: 300000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  console.log("\nresultado:");
  for (const [k, v] of Object.entries(contagens)) if (v > 0) console.log(`  ${k.padEnd(24)} ${v}`);

  const sobrou = {
    empresas: await prisma.organization.count(),
    colaboradores: await prisma.employee.count(),
    filiais: await prisma.branch.count(),
    cargos: await prisma.position.count(),
    setores: await prisma.department.count(),
    EPIs: await prisma.ppeItem.count(),
    kits: await prisma.ppeKit.count(),
    exigencias: await prisma.positionPpeRequirement.count(),
    usuarios: await prisma.user.count(),
  };
  console.log("\nsobrou no banco:");
  for (const [k, v] of Object.entries(sobrou)) console.log(`  ${k.padEnd(18)} ${v}`);
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
