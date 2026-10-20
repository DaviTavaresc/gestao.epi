import { Loader2, Inbox, AlertTriangle } from "lucide-react";
import { ReactNode } from "react";

export function Spinner({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Inbox className="h-8 w-8 text-slate-300" />
      <p className="font-medium text-slate-600">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-400">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-red-300" />
      <p className="font-medium text-red-600">{message}</p>
    </div>
  );
}

export function InlineBanner({ tone, children }: { tone: "error" | "warning" | "success" | "info"; children: ReactNode }) {
  const toneClasses = {
    error: "bg-red-50 text-red-700 border-red-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${toneClasses}`}>{children}</div>;
}
