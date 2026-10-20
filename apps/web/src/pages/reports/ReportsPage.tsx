import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { api } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Select, Input } from "../../components/ui/Field";
import { EmptyState, Spinner } from "../../components/ui/Feedback";

const reportTypes = [
  { value: "entregas", label: "Entregas" },
  { value: "colaboradores", label: "Colaboradores" },
  { value: "estoque", label: "Estoque" },
  { value: "movimentacoes", label: "Movimentações de estoque" },
  { value: "epis-por-colaborador", label: "EPIs por colaborador" },
  { value: "epis-por-setor", label: "EPIs por setor" },
  { value: "epis-vencidos", label: "EPIs vencidos" },
  { value: "epis-proximos-troca", label: "EPIs próximos da troca" },
  { value: "ca-vencidos", label: "CAs vencidos" },
  { value: "ca-proximos-vencimento", label: "CAs próximos do vencimento" },
  { value: "compras", label: "Compras" },
  { value: "devolucoes", label: "Devoluções" },
  { value: "fornecedores", label: "Fornecedores" },
  { value: "cargos", label: "Cargos" },
  { value: "setores", label: "Setores" },
  { value: "alertas", label: "Alertas" },
];

type ReportResult = { title: string; columns: { header: string; key: string }[]; rows: Record<string, unknown>[] };

export default function ReportsPage() {
  const [type, setType] = useState("entregas");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading } = useQuery<ReportResult>({
    queryKey: ["report", type, from, to],
    queryFn: async () => (await api.get(`/reports/${type}`, { params: { from: from || undefined, to: to || undefined } })).data,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Relatórios</h1>
        <p className="text-sm text-slate-500">Gere relatórios detalhados com filtros e exporte em Excel ou PDF.</p>
      </div>

      <Card>
        <CardHeader
          title="Filtros"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => downloadFromApi(`/reports/${type}`, { format: "xlsx", from: from || undefined, to: to || undefined }, `${type}.xlsx`)}>
                <FileSpreadsheet className="h-4 w-4" /> Excel
              </Button>
              <Button variant="outline" onClick={() => downloadFromApi(`/reports/${type}`, { format: "pdf", from: from || undefined, to: to || undefined }, `${type}.pdf`)}>
                <FileDown className="h-4 w-4" /> PDF
              </Button>
            </div>
          }
        />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Tipo de relatório" value={type} onChange={(e) => setType(e.target.value)}>
              {reportTypes.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
            <Input label="Data inicial" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label="Data final" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={data?.title ?? "Resultado"} subtitle={data ? `${data.rows.length} registro(s)` : undefined} />
        <CardBody className="p-0">
          {isLoading ? (
            <Spinner />
          ) : !data?.rows.length ? (
            <EmptyState title="Nenhum dado encontrado para os filtros selecionados" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                    {data.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-4 py-3">{c.header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 200).map((row, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      {data.columns.map((c) => <td key={c.key} className="whitespace-nowrap px-4 py-2">{String(row[c.key] ?? "")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.rows.length > 200 && <p className="px-4 py-3 text-xs text-slate-400">Mostrando 200 de {data.rows.length} registros. Exporte para ver todos.</p>}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
