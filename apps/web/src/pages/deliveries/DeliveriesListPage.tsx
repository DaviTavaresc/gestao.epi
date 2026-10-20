import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../../lib/api";
import { Delivery, Page } from "../../types";
import { Card } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/Badge";
import { Pagination } from "../../components/ui/Pagination";
import { usePermissions } from "../../hooks/usePermissions";
import { EmployeePickerModal } from "./EmployeePickerModal";
import { BranchFilter } from "../../components/BranchFilter";
import { CardHeader } from "../../components/ui/Card";

const tabs = [
  { label: "Pendentes", value: "PENDENTE" },
  { label: "Confirmadas", value: "CONFIRMADA" },
  { label: "Substituídas", value: "SUBSTITUIDA" },
  { label: "Canceladas", value: "CANCELADA" },
  { label: "Todas", value: "" },
];

export default function DeliveriesListPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["ALMOXARIFADO", "SEGURANCA_TRABALHO"]);
  const navigate = useNavigate();
  const [status, setStatus] = useState("PENDENTE");
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data, isLoading } = useQuery<Page<Delivery>>({
    queryKey: ["deliveries", status, page, branchId],
    queryFn: async () =>
      (await api.get("/deliveries", { params: { status: status || undefined, page, branchId: branchId || undefined } })).data,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Entregas</h1>
          <p className="text-sm text-slate-500">Prepare e acompanhe as entregas de EPI aos colaboradores.</p>
        </div>
        {canEdit && <Button onClick={() => setPickerOpen(true)}><Plus className="h-4 w-4" /> Nova entrega</Button>}
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatus(tab.value); setPage(1); }}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${status === tab.value ? "border-navy-600 text-navy-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title="Entregas" actions={<BranchFilter value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} />} />
        <DataTable
          columns={[
            { header: "Colaborador", cell: (d) => <span className="font-medium text-slate-700">{d.employee.nomeCompleto}</span> },
            { header: "Filial", cell: (d) => d.branch?.nome ?? "-" },
            { header: "Itens", cell: (d) => d.items.length },
            { header: "Motivo", cell: (d) => d.motivo },
            {
              header: "Data/hora",
              cell: (d) =>
                `${new Date(d.createdAt).toLocaleDateString("pt-BR")} ${new Date(d.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`,
            },
            { header: "Responsável", cell: (d) => d.createdBy.name },
            { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(d) => d.id}
          emptyTitle="Nenhuma entrega encontrada"
          onRowClick={(d) => navigate(`/entregas/${d.id}`)}
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <EmployeePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(employeeId) => navigate(`/entregas/nova?employeeId=${employeeId}`)}
      />
    </div>
  );
}
