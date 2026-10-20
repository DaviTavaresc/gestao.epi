import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { useToastStore } from "../../stores/toastStore";
import clsx from "clsx";

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const toneClasses = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  error: "bg-red-50 text-red-700 border-red-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
};

export function ToastHost() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div
            key={t.id}
            className={clsx("flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg", toneClasses[t.tone])}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-current opacity-60 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
