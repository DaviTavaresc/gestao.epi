import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { Delivery, Page } from "../../types";
import { Card } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StatusBadge } from "../../components/ui/Badge";
import { toast } from "../../stores/toastStore";
import { Pagination } from "../../components/ui/Pagination";
import { usePermissions } from "../../hooks/usePermissions";
import { EmployeePickerModal } from "./EmployeePickerModal";
import { ImportFichaModal } from "./ImportFichaModal";
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
  const { canWrite, role } = usePermissions();
  const canEdit = canWrite(["RH", "GERENTE"]);
  // Excluir apaga a entrega de vez, com a confirmação assinada e a ficha
  // digitalizada junto: fica com administrador e RH. A API repete a regra.
  const podeExcluir = role === "ADMIN" || role === "RH";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("PENDENTE");
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fichaOpen, setFichaOpen] = useState(false);
  const [excluindo, setExcluindo] = useState<Delivery | null>(null);

  const { data, isLoading } = useQuery<Page<Delivery>>({
    queryKey: ["deliveries", status, page, branchId],
    queryFn: async () =>
      (await api.get("/deliveries", { params: { status: status || undefined, page, branchId: branchId || undefined } })).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => api.delete(`/deliveries/${excluindo!.id}`),
    onSuccess: () => {
      toast.success("Entrega excluída.");
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      queryClient.invalidateQueries({ queryKey: ["employee"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setExcluindo(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Entregas</h1>
          <p className="text-sm text-slate-500">Prepare e acompanhe as entregas de EPI aos colaboradores.</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {/* A ficha importada nasce confirmada, então aparece na aba "Confirmadas". */}
            <Button variant="outline" onClick={() => setFichaOpen(true)}>
              <FileUp className="h-4 w-4" /> Importar ficha em papel
            </Button>
            <Button onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4" /> Nova entrega
            </Button>
          </div>
        )}
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
            ...(podeExcluir
              ? [
                  {
                    header: "",
                    // stopPropagation: a linha inteira abre a entrega ao ser clicada.
                    cell: (d: Delivery) => (
                      <div className="flex justify-end">
                        <Button
                          title="Excluir entrega"
                          variant="ghost"
                          size="sm"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            setExcluindo(d);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    ),
                    className: "text-right",
                  },
                ]
              : []),
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

      <ImportFichaModal open={fichaOpen} onClose={() => setFichaOpen(false)} />

      <ConfirmDialog
        open={!!excluindo}
        title="Excluir entrega"
        message={
          `Excluir a entrega de "${excluindo?.employee.nomeCompleto}"? Isso apaga a entrega de vez, junto com a ` +
          `confirmação assinada pelo colaborador, a foto e a ficha digitalizada, e não tem volta. ` +
          `Os itens voltam ao estoque, como no cancelamento. ` +
          `Para apenas tornar a entrega sem efeito mantendo o registro, abra a entrega e use Cancelar.`
        }
        confirmLabel="Excluir"
        tone="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => excluindo && deleteMutation.mutate()}
        onClose={() => setExcluindo(null)}
      />
    </div>
  );
}
