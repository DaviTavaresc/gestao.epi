// Calcula o status de vida útil de um item de entrega com base na data prevista de troca
// e nos limiares de alerta configurados pela organização (padrão: 30 / 15 / 7 dias).

export type LifecycleStatus = "REGULAR" | "PROXIMO_DA_TROCA" | "CRITICO" | "VENCIDO";

export function computeLifecycleStatus(
  dataPrevistaTroca: Date,
  now: Date,
  thresholds: { proximo: number; atencao: number; critico: number }
): LifecycleStatus {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.ceil((dataPrevistaTroca.getTime() - now.getTime()) / msPerDay);

  if (diffDays < 0) return "VENCIDO";
  if (diffDays <= thresholds.critico) return "CRITICO";
  if (diffDays <= thresholds.proximo) return "PROXIMO_DA_TROCA";
  return "REGULAR";
}

// Status efetivo de um item entregue. O valor gravado no banco só é definitivo
// nos estados terminais (devolvido/substituído); nos demais o que vale é a data
// de troca, senão um item vencido continuaria aparecendo como "Regular".
export function effectiveItemStatus(
  statusGravado: string,
  dataPrevistaTroca: Date,
  now: Date,
  thresholds: { proximo: number; atencao: number; critico: number }
): LifecycleStatus | "DEVOLVIDO" | "SUBSTITUIDO" {
  if (statusGravado === "DEVOLVIDO" || statusGravado === "SUBSTITUIDO") return statusGravado;
  return computeLifecycleStatus(dataPrevistaTroca, now, thresholds);
}

export function computeCaStatus(
  caValidade: Date,
  now: Date,
  thresholds: { proximo: number; atencao: number; critico: number }
): "VALIDO" | "PROXIMO_VENCIMENTO" | "VENCIDO" {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.ceil((caValidade.getTime() - now.getTime()) / msPerDay);
  if (diffDays < 0) return "VENCIDO";
  if (diffDays <= thresholds.proximo) return "PROXIMO_VENCIMENTO";
  return "VALIDO";
}
