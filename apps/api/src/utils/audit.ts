import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "CRIACAO"
  | "ALTERACAO"
  | "INATIVACAO"
  | "REATIVACAO"
  | "ENTREGA"
  | "CONFIRMACAO"
  | "DEVOLUCAO"
  | "COMPRA"
  | "ENTRADA_ESTOQUE"
  | "SAIDA_ESTOQUE"
  | "AJUSTE_ESTOQUE"
  | "ALTERACAO_PERMISSOES";

export async function writeAuditLog(
  tx: Prisma.TransactionClient | typeof prisma,
  params: {
    organizationId: string;
    userId: string | null;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    oldData?: unknown;
    newData?: unknown;
  }
) {
  await tx.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      oldData: params.oldData === undefined ? undefined : (params.oldData as Prisma.InputJsonValue),
      newData: params.newData === undefined ? undefined : (params.newData as Prisma.InputJsonValue),
    },
  });
}
