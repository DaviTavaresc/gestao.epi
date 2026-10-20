import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Truck } from "lucide-react";
import clsx from "clsx";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { api } from "../../lib/api";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/Badge";
import { EmptyState, Spinner } from "../../components/ui/Feedback";
import { usePermissions } from "../../hooks/usePermissions";

type TrocaRow = {
  deliveryId: string;
  employee: { id: string; nomeCompleto: string; position: { nome: string } | null; department: { nome: string } | null };
  ppeItem: { id: string; nome: string };
  dataPrevistaTroca: string;
  status: string;
};

const statusDotClass: Record<string, string> = {
  PROXIMO_DA_TROCA: "bg-sky-500",
  CRITICO: "bg-amber-500",
  VENCIDO: "bg-red-500",
};

export default function CalendarPage() {
  const { canWrite } = usePermissions();
  const canDeliver = canWrite(["ALMOXARIFADO"]);
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const { data, isLoading } = useQuery<TrocaRow[]>({
    queryKey: ["trocas", "calendar"],
    queryFn: async () => (await api.get("/deliveries/trocas/lista")).data,
  });

  const byDate = useMemo(() => {
    const map = new Map<string, TrocaRow[]>();
    for (const row of data ?? []) {
      const key = row.dataPrevistaTroca.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [data]);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const selectedItems = selectedDate ? byDate.get(format(selectedDate, "yyyy-MM-dd")) ?? [] : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Calendário de substituições</h1>
        <p className="text-sm text-slate-500">Visualize as trocas de EPI próximas, críticas e vencidas por data.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader
            title={format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
            actions={
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCursor((c) => subMonths(c, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
                  Hoje
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCursor((c) => addMonths(c, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            }
          />
          <CardBody>
            {isLoading ? (
              <Spinner />
            ) : (
              <div className="grid grid-cols-7 gap-1 text-sm">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                  <div key={d} className="px-2 py-1 text-center text-xs font-semibold uppercase text-slate-400">
                    {d}
                  </div>
                ))}
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const items = byDate.get(key) ?? [];
                  const worst = items.some((i) => i.status === "VENCIDO")
                    ? "VENCIDO"
                    : items.some((i) => i.status === "CRITICO")
                    ? "CRITICO"
                    : items.length > 0
                    ? "PROXIMO_DA_TROCA"
                    : null;

                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDate(day)}
                      className={clsx(
                        "flex h-20 flex-col items-start rounded-lg border p-2 text-left transition-colors",
                        !isSameMonth(day, cursor) && "opacity-40",
                        isToday(day) ? "border-navy-400 bg-navy-50" : "border-slate-100 hover:bg-slate-50",
                        selectedDate && isSameDay(day, selectedDate) && "ring-2 ring-navy-400"
                      )}
                    >
                      <span className="text-xs font-medium text-slate-600">{format(day, "d")}</span>
                      {items.length > 0 && (
                        <span className="mt-auto flex items-center gap-1 text-xs text-slate-500">
                          <span className={clsx("h-2 w-2 rounded-full", worst && statusDotClass[worst])} />
                          {items.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={selectedDate ? format(selectedDate, "dd/MM/yyyy") : "Selecione uma data"} />
          <CardBody className="p-0">
            {!selectedDate ? (
              <EmptyState title="Clique em um dia no calendário" />
            ) : selectedItems.length === 0 ? (
              <EmptyState title="Nenhuma troca nesta data" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {selectedItems.map((item, i) => (
                  <li key={i} className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">{item.employee.nomeCompleto}</span>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="text-slate-500">
                      {item.ppeItem.nome} · {item.employee.position?.nome ?? "-"} · {item.employee.department?.nome ?? "-"}
                    </p>
                    {canDeliver && (
                      <Button size="sm" variant="outline" onClick={() => navigate(`/entregas/nova?employeeId=${item.employee.id}`)}>
                        <Truck className="h-4 w-4" /> Substituir
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
