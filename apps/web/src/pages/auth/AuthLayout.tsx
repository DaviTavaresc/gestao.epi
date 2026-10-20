import { ReactNode } from "react";
import { ShieldHalf } from "lucide-react";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-700">
            <ShieldHalf className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-white">Sistema de Gestão de EPI</h1>
          {subtitle && <p className="text-sm text-navy-300">{subtitle}</p>}
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
