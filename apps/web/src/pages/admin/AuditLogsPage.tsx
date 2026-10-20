import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { AuditLog, Page } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Badge } from "../../components/ui/Badge";
import { Pagination } from "../../components/ui/Pagination";
import { Select } from "../../components/ui/Field";

const actionLabels: Record<string, string> = {
  LOGIN: "Login",
  LOGOUT: "Logout",
  CRIACAO: "Criação",
  ALTERACAO: "Alteração",
  INATIVACAO: "Inativação",
  REATIVACAO: "Reativação",
  ENTREGA: "Entrega",
  CONFIRMACAO: "Confirmação",
  DEVOLUCAO: "Devolução",
  COMPRA: "Compra",
  ENTRADA_ESTOQUE: "Entrada de estoque",
  SAIDA_ESTOQUE: "Saída de estoque",
  AJUSTE_ESTOQUE: "Ajuste de estoque",
  ALTERACAO_PERMISSOES: "Alteração de permissões",
};

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");

  const { data, isLoading } = useQuery<Page<AuditLog>>({
    queryKey: ["audit-logs", page, action],
    queryFn: async () => (await api.get("/audit-logs", { params: { page, action: action || undefined } })).data,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Auditoria</h1>
        <p className="text-sm text-slate-500">Histórico de ações relevantes realizadas no sistema. Registros não podem ser excluídos.</p>
      </div>

      <Card>
        <CardHeader
          title="Registros de auditoria"
          actions={
            <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="w-56">
              <option value="">Todas as ações</option>
              {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          }
        />
        <DataTable
          columns={[
            { header: "Data", cell: (l) => new Date(l.createdAt).toLocaleString("pt-BR") },
            { header: "Usuário", cell: (l) => l.user?.name ?? "Sistema" },
            { header: "Ação", cell: (l) => <Badge tone="navy">{actionLabels[l.action] ?? l.action}</Badge> },
            { header: "Entidade", cell: (l) => l.entityType },
            { header: "ID do registro", cell: (l) => <span className="text-xs text-slate-400">{l.entityId ?? "-"}</span> },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(l) => l.id}
          emptyTitle="Nenhum registro de auditoria encontrado"
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
