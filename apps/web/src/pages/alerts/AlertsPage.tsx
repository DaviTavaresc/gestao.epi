import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileDown, FileSpreadsheet } from "lucide-react";
import { api } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Alert, Page } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Field";
import { StatusBadge } from "../../components/ui/Badge";
import { Pagination } from "../../components/ui/Pagination";
import { toast } from "../../stores/toastStore";

export default function AlertsPage() {
  const [status, setStatus] = useState("ABERTO");
  const [prioridade, setPrioridade] = useState("");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Page<Alert> & { countAbertos: number }>({
    queryKey: ["alerts", status, prioridade, page],
    queryFn: async () => (await api.get("/alerts", { params: { status, prioridade: prioridade || undefined, page } })).data,
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/alerts/${id}/resolver`),
    onSuccess: () => {
      toast.success("Alerta resolvido.");
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Alertas</h1>
          <p className="text-sm text-slate-500">Estoque, validade de CA, trocas e confirmações pendentes.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/alertas", { format: "xlsx" }, "alertas.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/alertas", { format: "pdf" }, "alertas.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Lista de alertas"
          actions={
            <div className="flex gap-2">
              <Select value={prioridade} onChange={(e) => { setPrioridade(e.target.value); setPage(1); }} className="w-40">
                <option value="">Todas prioridades</option>
                <option value="CRITICO">Crítico</option>
                <option value="ATENCAO">Atenção</option>
                <option value="INFORMACAO">Informação</option>
              </Select>
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
                <option value="ABERTO">Abertos</option>
                <option value="LIDO">Lidos</option>
                <option value="RESOLVIDO">Resolvidos</option>
                <option value="TODOS">Todos</option>
              </Select>
            </div>
          }
        />
        <DataTable
          columns={[
            { header: "Prioridade", cell: (a) => <StatusBadge status={a.prioridade} /> },
            { header: "Título", cell: (a) => <span className="font-medium text-slate-700">{a.titulo}</span> },
            { header: "Mensagem", cell: (a) => <span className="text-slate-500">{a.mensagem}</span> },
            { header: "Data", cell: (a) => new Date(a.createdAt).toLocaleDateString("pt-BR") },
            { header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
            {
              header: "",
              cell: (a) =>
                a.status !== "RESOLVIDO" && (
                  <Button variant="ghost" size="sm" onClick={() => resolveMutation.mutate(a.id)}>
                    <CheckCircle2 className="h-4 w-4" /> Resolver
                  </Button>
                ),
              className: "text-right",
            },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(a) => a.id}
          emptyTitle="Nenhum alerta encontrado"
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
