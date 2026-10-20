import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { api } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { StockMovement, Page } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Pagination } from "../../components/ui/Pagination";
import { BranchFilter } from "../../components/BranchFilter";

const movementLabels: Record<string, string> = {
  ENTRADA_COMPRA: "Entrada (compra)",
  SAIDA_ENTREGA: "Saída (entrega)",
  DEVOLUCAO: "Devolução",
  AJUSTE_POSITIVO: "Ajuste positivo",
  AJUSTE_NEGATIVO: "Ajuste negativo",
  PERDA: "Perda",
  DANIFICACAO: "Danificação",
  DESCARTE: "Descarte",
};

export default function StockMovementsPage() {
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState("");

  const { data, isLoading } = useQuery<Page<StockMovement>>({
    queryKey: ["stock-movements", page, branchId],
    queryFn: async () => (await api.get("/stock/movements", { params: { page, branchId: branchId || undefined } })).data,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Movimentações de estoque</h1>
          <p className="text-sm text-slate-500">Histórico completo de entradas, saídas e ajustes.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/movimentacoes", { format: "xlsx" }, "movimentacoes.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/movimentacoes", { format: "pdf" }, "movimentacoes.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Histórico de movimentações"
          actions={<BranchFilter value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} />}
        />
        <DataTable
          columns={[
            { header: "Data", cell: (m) => new Date(m.createdAt).toLocaleString("pt-BR") },
            { header: "Filial", cell: (m) => m.branch?.nome ?? "-" },
            { header: "EPI", cell: (m) => m.ppeItem.nome },
            { header: "Tipo", cell: (m) => <Badge tone="navy">{movementLabels[m.tipo] ?? m.tipo}</Badge> },
            { header: "Qtd", cell: (m) => m.quantidade },
            { header: "Antes → Depois", cell: (m) => `${m.estoqueAnterior} → ${m.estoquePosterior}` },
            { header: "Usuário", cell: (m) => m.user.name },
            { header: "Motivo", cell: (m) => m.motivo || "-" },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(m) => m.id}
          emptyTitle="Nenhuma movimentação registrada"
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
