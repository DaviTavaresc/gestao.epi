import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

// Custo de referência para cobrar um EPI do colaborador.
// Prioriza o custo unitário da filial, que é atualizado a cada recebimento de nota fiscal,
// e cai para o custo padrão do catálogo quando a filial ainda não teve nenhuma entrada.
export async function custoUnitarioDeReferencia(
  tx: Tx,
  organizationId: string,
  branchId: string | null,
  ppeItemId: string
): Promise<Prisma.Decimal> {
  if (branchId) {
    const estoque = await tx.branchStock.findFirst({
      where: { organizationId, branchId, ppeItemId },
      select: { custoUnitario: true },
    });
    if (estoque && !estoque.custoUnitario.isZero()) return estoque.custoUnitario;
  }

  const item = await tx.ppeItem.findFirst({ where: { id: ppeItemId, organizationId }, select: { custoUnitario: true } });
  return item?.custoUnitario ?? new Prisma.Decimal(0);
}

// Estados de devolução em que o EPI não volta ao estoque e o prejuízo é atribuível ao colaborador.
export function estadoGeraCobranca(estado: string): boolean {
  return estado === "DANIFICADO" || estado === "INUTILIZAVEL";
}
