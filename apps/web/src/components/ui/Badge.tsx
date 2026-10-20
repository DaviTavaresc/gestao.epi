import { ReactNode } from "react";
import clsx from "clsx";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "navy";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
  info: "bg-sky-100 text-sky-700",
  navy: "bg-navy-100 text-navy-700",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", toneClasses[tone], className)}>
      {children}
    </span>
  );
}

const statusToneMap: Record<string, Tone> = {
  ATIVO: "success",
  INATIVO: "neutral",
  AFASTADO: "warning",
  FERIAS: "info",
  DESLIGADO: "danger",
  REGULAR: "success",
  PROXIMO_DA_TROCA: "warning",
  CRITICO: "danger",
  VENCIDO: "danger",
  NUNCA_ENTREGUE: "neutral",
  DEVOLVIDO: "neutral",
  SUBSTITUIDO: "neutral",
  VALIDO: "success",
  PROXIMO_VENCIMENTO: "warning",
  NORMAL: "success",
  ATENCAO: "warning",
  SEM_ESTOQUE: "danger",
  PENDENTE: "warning",
  CONFIRMADA: "success",
  EXPIRADA: "danger",
  CANCELADA: "neutral",
  RASCUNHO: "neutral",
  RECEBIDA: "success",
  ABERTO: "warning",
  LIDO: "info",
  RESOLVIDO: "success",
};

const statusLabelMap: Record<string, string> = {
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  AFASTADO: "Afastado",
  FERIAS: "Férias",
  DESLIGADO: "Desligado",
  REGULAR: "Regular",
  PROXIMO_DA_TROCA: "Próximo da troca",
  CRITICO: "Crítico",
  VENCIDO: "Vencido",
  NUNCA_ENTREGUE: "Nunca entregue",
  DEVOLVIDO: "Devolvido",
  SUBSTITUIDO: "Substituído",
  VALIDO: "Válido",
  PROXIMO_VENCIMENTO: "Próximo do vencimento",
  NORMAL: "Normal",
  ATENCAO: "Atenção",
  SEM_ESTOQUE: "Sem estoque",
  PENDENTE: "Pendente",
  CONFIRMADA: "Confirmada",
  EXPIRADA: "Expirada",
  CANCELADA: "Cancelada",
  RASCUNHO: "Rascunho",
  RECEBIDA: "Recebida",
  ABERTO: "Aberto",
  LIDO: "Lido",
  RESOLVIDO: "Resolvido",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusToneMap[status] ?? "neutral"}>{statusLabelMap[status] ?? status}</Badge>;
}
