import { Prisma } from "@prisma/client";
import { badRequest } from "./httpError";

type Tx = Prisma.TransactionClient;

type MovementType =
  | "ENTRADA_COMPRA"
  | "SAIDA_ENTREGA"
  | "DEVOLUCAO"
  | "AJUSTE_POSITIVO"
  | "AJUSTE_NEGATIVO"
  | "PERDA"
  | "DANIFICACAO"
  | "DESCARTE";

const INBOUND: MovementType[] = ["ENTRADA_COMPRA", "DEVOLUCAO", "AJUSTE_POSITIVO"];

// Busca o estoque do EPI na filial, criando o registro na primeira vez
// com os valores mínimos/máximos padrão do catálogo.
export async function getOrCreateBranchStock(tx: Tx, organizationId: string, branchId: string, ppeItemId: string) {
  const existing = await tx.branchStock.findUnique({ where: { branchId_ppeItemId: { branchId, ppeItemId } } });
  if (existing) return existing;

  const ppeItem = await tx.ppeItem.findFirst({ where: { id: ppeItemId, organizationId } });
  if (!ppeItem) throw badRequest("EPI inválido.");

  return tx.branchStock.create({
    data: {
      organizationId,
      branchId,
      ppeItemId,
      estoqueAtual: 0,
      estoqueMinimo: ppeItem.estoqueMinimo,
      estoqueMaximo: ppeItem.estoqueMaximo,
      // Parte do custo de referência do catálogo até que a filial tenha a própria compra.
      custoUnitario: ppeItem.custoUnitario,
    },
  });
}

// Única porta de entrada para alterar estoque: sempre gera movimentação com
// saldo anterior/posterior e nunca permite estoque negativo.
export async function applyStockMovement(
  tx: Tx,
  params: {
    organizationId: string;
    branchId: string;
    ppeItemId: string;
    tipo: MovementType;
    quantidade: number;
    motivo?: string | null;
    referencia?: string | null;
    userId: string;
  }
) {
  const stock = await getOrCreateBranchStock(tx, params.organizationId, params.branchId, params.ppeItemId);
  const isInbound = INBOUND.includes(params.tipo);
  const estoquePosterior = isInbound ? stock.estoqueAtual + params.quantidade : stock.estoqueAtual - params.quantidade;

  if (estoquePosterior < 0) {
    throw badRequest(`Estoque insuficiente nesta filial. Disponível: ${stock.estoqueAtual}, solicitado: ${params.quantidade}.`);
  }

  const movement = await tx.stockMovement.create({
    data: {
      organizationId: params.organizationId,
      branchId: params.branchId,
      ppeItemId: params.ppeItemId,
      tipo: params.tipo,
      quantidade: params.quantidade,
      estoqueAnterior: stock.estoqueAtual,
      estoquePosterior,
      motivo: params.motivo ?? null,
      referencia: params.referencia ?? null,
      userId: params.userId,
    },
  });

  await tx.branchStock.update({ where: { id: stock.id }, data: { estoqueAtual: estoquePosterior } });

  return { movement, estoqueAnterior: stock.estoqueAtual, estoquePosterior };
}

export function stockStatus(stock: { estoqueAtual: number; estoqueMinimo: number }) {
  if (stock.estoqueAtual <= 0) return "SEM_ESTOQUE";
  if (stock.estoqueAtual < stock.estoqueMinimo) return "CRITICO";
  if (stock.estoqueAtual < stock.estoqueMinimo * 1.3) return "ATENCAO";
  return "NORMAL";
}
