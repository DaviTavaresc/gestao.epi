import { Prisma } from "@prisma/client";

// Exclusão em cascata de uma empresa ou filial.
//
// Esta é a operação mais destrutiva do sistema: ela apaga o histórico de
// entrega de EPI, que é prova legal. Existe porque foi pedida explicitamente,
// e por isso tudo aqui é feito de forma consciente, e não por onDelete Cascade
// no schema — um cascade no banco apagaria em silêncio, sem contagem, sem
// auditoria e sem o operador saber o tamanho do estrago. Aqui a conta é
// levantada antes, mostrada na tela, confirmada digitando o nome, e só então
// executada dentro de uma transação única: ou tudo sai, ou nada sai.
//
// Duas coisas NÃO são apagadas, de propósito:
//
// 1. O usuário (a conta de acesso). Ele é a pessoa, não a filial: pode ter
//    assinado entregas em outro CNPJ, e apagá-lo levaria junto registros que
//    não têm nada com esta exclusão. Ele perde o vínculo com esta filial e,
//    se tiver ficado sem nenhuma, é inativado. Inativar é parte da regra, não
//    zelo extra: um usuário sem vínculo vira perfil corporativo e passaria a
//    enxergar o grupo inteiro.
//
// 2. O colaborador que apenas TEM CONTRATO com esta empresa mas trabalha em
//    outra filial. Ele continua existindo, só perde o vínculo de contrato.
//    Apagá-lo destruiria o cadastro de uma filial que ninguém mandou excluir.

export type ImpactoDaExclusao = {
  id: string;
  nome: string;
  ehEmpresa: boolean;
  filiais: ImpactoDaExclusao[];
  colaboradores: number;
  contratosDesvinculados: number;
  usuariosDesvinculados: number;
  entregas: number;
  devolucoes: number;
  cobrancas: number;
  movimentacoes: number;
  itensEmEstoque: number;
  compras: number;
  documentos: number;
  alertas: number;
};

type Tx = Prisma.TransactionClient;

// A filial e todas as descendentes. Quem trabalha em qualquer uma delas vai ser
// apagado, entao nao pode ser contado como "apenas desvinculado".
async function idsDaArvore(tx: Tx, branchId: string): Promise<string[]> {
  const filhas = await tx.branch.findMany({ where: { parentId: branchId }, select: { id: true } });
  const ids = [branchId];
  for (const f of filhas) ids.push(...(await idsDaArvore(tx, f.id)));
  return ids;
}

// Ids dos registros que saem junto com a filial. É a mesma consulta usada pela
// prévia e pela exclusão, para a conta mostrada na tela ser a conta executada.
async function levantarIds(tx: Tx, branchId: string) {
  const colaboradores = (await tx.employee.findMany({ where: { branchId }, select: { id: true } })).map((e) => e.id);

  const entregas = (
    await tx.delivery.findMany({
      where: { OR: [{ branchId }, { employeeId: { in: colaboradores } }] },
      select: { id: true },
    })
  ).map((d) => d.id);

  const itensDeEntrega = (
    await tx.deliveryItem.findMany({ where: { deliveryId: { in: entregas } }, select: { id: true } })
  ).map((i) => i.id);

  const devolucoes = (
    await tx.ppeReturn.findMany({
      where: { OR: [{ employeeId: { in: colaboradores } }, { deliveryItemId: { in: itensDeEntrega } }] },
      select: { id: true },
    })
  ).map((r) => r.id);

  const compras = (await tx.purchase.findMany({ where: { branchId }, select: { id: true } })).map((c) => c.id);

  return { colaboradores, entregas, itensDeEntrega, devolucoes, compras };
}

export async function levantarImpacto(tx: Tx, branchId: string): Promise<ImpactoDaExclusao> {
  const filial = await tx.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { id: true, nome: true, parentId: true },
  });

  const filhas = await tx.branch.findMany({ where: { parentId: branchId }, select: { id: true }, orderBy: { nome: "asc" } });
  const filiais: ImpactoDaExclusao[] = [];
  for (const f of filhas) filiais.push(await levantarImpacto(tx, f.id));

  const ids = await levantarIds(tx, branchId);
  const arvore = await idsDaArvore(tx, branchId);

  const [contratosDesvinculados, usuariosDesvinculados, cobrancas, movimentacoes, itensEmEstoque, documentos, alertas] =
    await Promise.all([
      // Só conta quem fica de pé: quem tem contrato com esta empresa mas
      // trabalha fora da árvore que vai ser apagada. Quem trabalha numa das
      // filiais daqui some junto e já está contado em `colaboradores`.
      // O branchId nulo entra explicitamente porque, em SQL, NOT IN sobre NULL
      // não dá verdadeiro — sem isso, um colaborador sem filial ficaria fora da
      // conta e apareceria como surpresa depois da exclusão.
      tx.employee.count({
        where: {
          contractBranchId: branchId,
          OR: [{ branchId: null }, { branchId: { notIn: arvore } }],
        },
      }),
      tx.user.count({ where: { branches: { some: { branchId } } } }),
      tx.employeeCharge.count({
        where: {
          OR: [
            { branchId },
            { employeeId: { in: ids.colaboradores } },
            { deliveryItemId: { in: ids.itensDeEntrega } },
            { ppeReturnId: { in: ids.devolucoes } },
          ],
        },
      }),
      tx.stockMovement.count({ where: { branchId } }),
      tx.branchStock.count({ where: { branchId } }),
      tx.document.count({ where: { OR: [{ deliveryId: { in: ids.entregas } }, { purchaseId: { in: ids.compras } }] } }),
      tx.alert.count({ where: { branchId } }),
    ]);

  return {
    id: filial.id,
    nome: filial.nome,
    ehEmpresa: !filial.parentId,
    filiais,
    colaboradores: ids.colaboradores.length,
    contratosDesvinculados,
    usuariosDesvinculados,
    entregas: ids.entregas.length,
    devolucoes: ids.devolucoes.length,
    cobrancas,
    movimentacoes,
    itensEmEstoque,
    compras: ids.compras.length,
    documentos,
    alertas,
  };
}

export type TotaisDoImpacto = Omit<ImpactoDaExclusao, "id" | "nome" | "ehEmpresa" | "filiais">;

// Soma a árvore (empresa + filiais) num total só, para a tela conseguir dizer
// numa frase o tamanho do que vai sair.
export function somarImpacto(no: ImpactoDaExclusao): TotaisDoImpacto {
  const base: TotaisDoImpacto = {
    colaboradores: no.colaboradores,
    contratosDesvinculados: no.contratosDesvinculados,
    usuariosDesvinculados: no.usuariosDesvinculados,
    entregas: no.entregas,
    devolucoes: no.devolucoes,
    cobrancas: no.cobrancas,
    movimentacoes: no.movimentacoes,
    itensEmEstoque: no.itensEmEstoque,
    compras: no.compras,
    documentos: no.documentos,
    alertas: no.alertas,
  };
  for (const f of no.filiais) {
    const sub = somarImpacto(f);
    for (const chave of Object.keys(base) as (keyof TotaisDoImpacto)[]) base[chave] += sub[chave];
  }
  return base;
}

export type ArquivoParaRemover = { pasta: "documents" | "confirmations"; nome: string };

// Apaga a filial e tudo que depende dela, na ordem em que as chaves
// estrangeiras permitem. A filial-pai só sai depois das filhas.
//
// Devolve os arquivos a remover do disco. A remoção acontece FORA da
// transação, de propósito: apagar arquivo não tem rollback, então se a
// transação falhasse depois, o registro continuaria apontando para um arquivo
// que já não existe.
export async function excluirFilialEmCascata(tx: Tx, branchId: string): Promise<ArquivoParaRemover[]> {
  const arquivos: ArquivoParaRemover[] = [];

  const filhas = await tx.branch.findMany({ where: { parentId: branchId }, select: { id: true } });
  for (const f of filhas) arquivos.push(...(await excluirFilialEmCascata(tx, f.id)));

  const ids = await levantarIds(tx, branchId);

  // Guarda os caminhos antes de apagar as linhas que os conhecem.
  const confirmacoes = await tx.electronicConfirmation.findMany({
    where: { OR: [{ deliveryId: { in: ids.entregas } }, { employeeId: { in: ids.colaboradores } }] },
    select: { id: true, photoPath: true },
  });
  for (const c of confirmacoes) if (c.photoPath) arquivos.push({ pasta: "confirmations", nome: c.photoPath });

  const documentos = await tx.document.findMany({
    where: { OR: [{ deliveryId: { in: ids.entregas } }, { purchaseId: { in: ids.compras } }] },
    select: { id: true, storagePath: true },
  });
  for (const d of documentos) arquivos.push({ pasta: "documents", nome: d.storagePath });

  // 1. Cobranças: dependem de item de entrega e de devolução, então saem primeiro.
  await tx.employeeCharge.deleteMany({
    where: {
      OR: [
        { branchId },
        { employeeId: { in: ids.colaboradores } },
        { deliveryItemId: { in: ids.itensDeEntrega } },
        { ppeReturnId: { in: ids.devolucoes } },
      ],
    },
  });

  // 2. Devoluções, que dependem de item de entrega.
  await tx.ppeReturn.deleteMany({ where: { id: { in: ids.devolucoes } } });

  // 3. Confirmação eletrônica e fichas digitalizadas, que dependem da entrega.
  await tx.electronicConfirmation.deleteMany({ where: { id: { in: confirmacoes.map((c) => c.id) } } });
  await tx.document.deleteMany({ where: { id: { in: documentos.map((d) => d.id) } } });

  // 4. Compras (os itens caem por cascade no schema).
  await tx.purchase.deleteMany({ where: { id: { in: ids.compras } } });

  // 5. Entregas (os itens caem por cascade no schema).
  await tx.delivery.deleteMany({ where: { id: { in: ids.entregas } } });

  // 6. Colaboradores lotados nesta filial.
  await tx.employee.deleteMany({ where: { id: { in: ids.colaboradores } } });

  // 7. Quem trabalha em outra filial mas tinha contrato com esta: só perde o
  //    vínculo de contrato, o cadastro fica.
  await tx.employee.updateMany({ where: { contractBranchId: branchId }, data: { contractBranchId: null } });

  // 8. Estoque e livro de movimentações.
  await tx.stockMovement.deleteMany({ where: { branchId } });
  await tx.branchStock.deleteMany({ where: { branchId } });
  await tx.alert.deleteMany({ where: { branchId } });

  // 9. Acessos: desvincula, nunca apaga. Ver o comentário do topo.
  //
  // Quem respondia por mais filiais continua ativo com as que sobraram — perder
  // uma loja não tira o gerente das outras duas. Só é inativado quem ficou sem
  // nenhuma: sem vínculo, o usuário viraria perfil corporativo e passaria a
  // enxergar o grupo inteiro, que é o oposto de ter perdido a única filial.
  const vinculados = (
    await tx.userBranch.findMany({ where: { branchId }, select: { userId: true } })
  ).map((v) => v.userId);
  await tx.userBranch.deleteMany({ where: { branchId } });
  if (vinculados.length > 0) {
    const semNenhuma = (
      await tx.user.findMany({
        where: { id: { in: vinculados }, branches: { none: {} } },
        select: { id: true },
      })
    ).map((u) => u.id);
    if (semNenhuma.length > 0) {
      await tx.user.updateMany({ where: { id: { in: semNenhuma } }, data: { status: "INATIVO" } });
    }
  }

  await tx.branch.delete({ where: { id: branchId } });
  return arquivos;
}
