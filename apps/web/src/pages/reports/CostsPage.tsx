import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { DollarSign, Calendar, TrendingUp, FileDown, FileSpreadsheet } from "lucide-react";
import { api } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { StatCard } from "../../components/ui/StatCard";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner, EmptyState } from "../../components/ui/Feedback";

type CostRow = { data: string; colaborador: string; setor: string; epi: string; quantidade: number; custoUnitario: number; custoTotal: number };
type ReportResult = { title: string; columns: unknown[]; rows: CostRow[] };

export default function CostsPage() {
  const { data, isLoading } = useQuery<ReportResult>({
    queryKey: ["report", "custos"],
    queryFn: async () => (await api.get("/reports/custos")).data,
  });

  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    const now = new Date();
    let custoMensal = 0;
    let custoAnual = 0;
    const porEpi = new Map<string, number>();
    const porSetor = new Map<string, number>();

    for (const row of rows) {
      const [day, month, year] = row.data.split("/").map(Number);
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === now.getFullYear()) {
        custoAnual += row.custoTotal;
        if (date.getMonth() === now.getMonth()) custoMensal += row.custoTotal;
      }
      porEpi.set(row.epi, (porEpi.get(row.epi) ?? 0) + row.custoTotal);
      porSetor.set(row.setor, (porSetor.get(row.setor) ?? 0) + row.custoTotal);
    }

    return {
      custoMensal,
      custoAnual,
      custoTotal: rows.reduce((acc, r) => acc + r.custoTotal, 0),
      porEpi: Array.from(porEpi.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nome, total]) => ({ nome, total: Math.round(total * 100) / 100 })),
      porSetor: Array.from(porSetor.entries()).sort((a, b) => b[1] - a[1]).map(([setor, total]) => ({ setor, total: Math.round(total * 100) / 100 })),
    };
  }, [data]);

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Custos</h1>
          <p className="text-sm text-slate-500">Visão financeira dos EPIs entregues.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/custos", { format: "xlsx" }, "custos.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/custos", { format: "pdf" }, "custos.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Custo no mês atual" value={`R$ ${summary.custoMensal.toFixed(2)}`} icon={Calendar} tone="navy" />
        <StatCard label="Custo no ano atual" value={`R$ ${summary.custoAnual.toFixed(2)}`} icon={TrendingUp} tone="info" />
        <StatCard label="Custo total registrado" value={`R$ ${summary.custoTotal.toFixed(2)}`} icon={DollarSign} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="EPIs com maior custo" />
          <CardBody>
            {summary.porEpi.length === 0 ? (
              <EmptyState title="Sem dados de custo" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={summary.porEpi} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `R$ ${Number(v).toFixed(2)}`} />
                  <Bar dataKey="total" fill="#2d4a8a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Setores com maior consumo" />
          <CardBody>
            {summary.porSetor.length === 0 ? (
              <EmptyState title="Sem dados por setor" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={summary.porSetor}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="setor" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => `R$ ${Number(v).toFixed(2)}`} />
                  <Bar dataKey="total" fill="#5f7fc0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
