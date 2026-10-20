import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import clsx from "clsx";

type Tone = "navy" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  navy: "bg-navy-50 text-navy-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-700",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "navy",
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", toneClasses[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-semibold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}
