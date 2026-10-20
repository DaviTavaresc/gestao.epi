import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Truck } from "lucide-react";
import { api } from "../../lib/api";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Field";
import { StatusBadge } from "../../components/ui/Badge";
import { usePermissions } from "../../hooks/usePermissions";
import { BranchFilter } from "../../components/BranchFilter";

type TrocaRow = {
  deliveryId: string;
  employee: {
    id: string;
    nomeCompleto: string;
    position: { nome: string } | null;
    department: { nome: string } | null;
    branch: { nome: string } | null;
  };
  ppeItem: { id: string; nome: string };
  dataPrevistaTroca: string;
  status: string;
};

export default function TrocasPage() {
  const { canWrite } = usePermissions();
  const canDeliver = canWrite(["ALMOXARIFADO"]);
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [branchId, setBranchId] = useState("");

  const { data, isLoading } = useQuery<TrocaRow[]>({
    queryKey: ["trocas", status, branchId],
    queryFn: async () =>
      (await api.get("/deliveries/trocas/lista", { params: { status: status || undefined, branchId: branchId || undefined } })).data,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Trocas</h1>
        <p className="text-sm text-slate-500">EPIs próximos da troca, críticos ou vencidos entre os colaboradores.</p>
      </div>

      <Card>
        <CardHeader
          title="EPIs pendentes de substituição"
          actions={
            <div className="flex gap-2">
              <BranchFilter value={branchId} onChange={setBranchId} />
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
                <option value="">Todos os status</option>
                <option value="PROXIMO_DA_TROCA">Próximo da troca</option>
                <option value="CRITICO">Crítico</option>
                <option value="VENCIDO">Vencido</option>
              </Select>
            </div>
          }
        />
        <DataTable
          columns={[
            { header: "Colaborador", cell: (r) => r.employee.nomeCompleto },
            { header: "Filial", cell: (r) => r.employee.branch?.nome ?? "-" },
            { header: "Cargo", cell: (r) => r.employee.position?.nome ?? "-" },
            { header: "Setor", cell: (r) => r.employee.department?.nome ?? "-" },
            { header: "EPI", cell: (r) => r.ppeItem.nome },
            { header: "Troca prevista", cell: (r) => new Date(r.dataPrevistaTroca).toLocaleDateString("pt-BR") },
            { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            {
              header: "",
              cell: (r) =>
                canDeliver && (
                  <Button size="sm" onClick={() => navigate(`/entregas/nova?employeeId=${r.employee.id}`)}>
                    <Truck className="h-4 w-4" /> Substituir
                  </Button>
                ),
              className: "text-right",
            },
          ]}
          rows={data ?? []}
          loading={isLoading}
          rowKey={(r) => `${r.deliveryId}-${r.ppeItem.id}`}
          emptyTitle="Nenhuma troca pendente"
        />
      </Card>
    </div>
  );
}
