import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Truck, ShieldCheck, Clock3, AlertTriangle, RotateCcw } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { StatCard } from "../../components/ui/StatCard";
import { StatusBadge, Badge } from "../../components/ui/Badge";
import { Spinner, EmptyState } from "../../components/ui/Feedback";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Field";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";
import { Employee, PpeItem, PositionRequirement, Delivery, PpeReturn } from "../../types";

type CurrentPpeItem = {
  deliveryId: string;
  deliveryItemId: string;
  ppeItem: PpeItem;
  ca: string;
  quantidade: number;
  dataEntrega: string;
  dataPrevistaTroca: string;
  status: string;
};

type DetailResponse = {
  employee: Employee;
  resumo: { totalRecebidos: number; ativos: number; proximosDaTroca: number; vencidos: number; devolvidos: number };
  episAtuais: CurrentPpeItem[];
  matrizCargoEpi: { ppeItem: PositionRequirement["ppeItem"]; quantidadeExigida: number; status: string; delivered: unknown }[];
  historico: { entregas: Delivery[]; devolucoes: PpeReturn[] };
};

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["SEGURANCA_TRABALHO"]);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<DetailResponse>({
    queryKey: ["employee", id],
    queryFn: async () => (await api.get(`/employees/${id}`)).data,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => api.patch(`/employees/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["employee", id] });
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <EmptyState title="Colaborador não encontrado" />;

  const { employee, resumo, episAtuais, matrizCargoEpi, historico } = data;

  return (
    <div className="space-y-6">
      <button onClick={() => navigate("/colaboradores")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Voltar para colaboradores
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{employee.nomeCompleto}</h1>
          <p className="text-sm text-slate-500">
            CPF {employee.cpf} · Matrícula {employee.matricula} · {employee.position?.nome ?? "Sem cargo"} ·{" "}
            {employee.department?.nome ?? "Sem setor"}
          </p>
          {employee.branch && (
            <p className="text-sm font-medium text-navy-700">Filial: {employee.branch.nome}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={employee.status} />
          {canEdit && (
            <Select
              className="w-40"
              value=""
              onChange={(e) => e.target.value && statusMutation.mutate(e.target.value)}
            >
              <option value="">Alterar status...</option>
              <option value="ATIVO">Ativo</option>
              <option value="AFASTADO">Afastado</option>
              <option value="FERIAS">Férias</option>
              <option value="DESLIGADO">Desligado</option>
            </Select>
          )}
          {canWrite(["ALMOXARIFADO"]) && employee.status === "ATIVO" && (
            <Button onClick={() => navigate(`/entregas/nova?employeeId=${employee.id}`)}>
              <Truck className="h-4 w-4" /> Preparar entrega
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Total recebidos" value={resumo.totalRecebidos} icon={Truck} tone="navy" />
        <StatCard label="Ativos" value={resumo.ativos} icon={ShieldCheck} tone="success" />
        <StatCard label="Próximos da troca" value={resumo.proximosDaTroca} icon={Clock3} tone="warning" />
        <StatCard label="Vencidos" value={resumo.vencidos} icon={AlertTriangle} tone="danger" />
        <StatCard label="Devolvidos" value={resumo.devolvidos} icon={RotateCcw} tone="info" />
      </div>

      <Card>
        <CardHeader title="Matriz Cargo x EPI" subtitle="EPIs obrigatórios para o cargo deste colaborador" />
        <CardBody className="p-0">
          {matrizCargoEpi.length === 0 ? (
            <EmptyState title="Nenhum EPI obrigatório configurado para este cargo" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {matrizCargoEpi.map((item, i) => (
                <li key={i} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-700">{item.ppeItem.nome}</p>
                    <p className="text-slate-400">Quantidade exigida: {item.quantidadeExigida}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="EPIs atuais" subtitle="EPIs entregues e confirmados que ainda não foram devolvidos" />
        <CardBody className="p-0">
          {episAtuais.length === 0 ? (
            <EmptyState title="Nenhum EPI ativo com este colaborador" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                    <th className="px-5 py-3">EPI</th>
                    <th className="px-5 py-3">CA</th>
                    <th className="px-5 py-3">Qtd</th>
                    <th className="px-5 py-3">Entrega</th>
                    <th className="px-5 py-3">Troca prevista</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {episAtuais.map((item) => (
                    <tr key={item.deliveryItemId} className="border-b border-slate-50">
                      <td className="px-5 py-3">{item.ppeItem.nome}</td>
                      <td className="px-5 py-3">{item.ca}</td>
                      <td className="px-5 py-3">{item.quantidade}</td>
                      <td className="px-5 py-3">{new Date(item.dataEntrega).toLocaleDateString("pt-BR")}</td>
                      <td className="px-5 py-3">{new Date(item.dataPrevistaTroca).toLocaleDateString("pt-BR")}</td>
                      <td className="px-5 py-3"><StatusBadge status={item.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Histórico" subtitle="Linha do tempo de entregas, confirmações e devoluções" />
        <CardBody className="p-0">
          {historico.entregas.length === 0 && historico.devolucoes.length === 0 ? (
            <EmptyState title="Nenhum histórico registrado" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {historico.entregas.map((d) => (
                <li key={d.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <Link to={`/entregas/${d.id}`} className="font-medium text-navy-700 hover:underline">
                      Entrega · {d.items.length} item(ns)
                    </Link>
                    <StatusBadge status={d.status} />
                  </div>
                  <p className="text-xs text-slate-400">
                    {new Date(d.createdAt).toLocaleString("pt-BR")} · Motivo: {d.motivo} · Por {d.createdBy.name}
                  </p>
                  {d.confirmation && (
                    <p className="text-xs text-emerald-600">
                      Confirmado eletronicamente por "{d.confirmation.nomeDigitado}" em {new Date(d.confirmation.confirmedAt).toLocaleString("pt-BR")}
                    </p>
                  )}
                </li>
              ))}
              {historico.devolucoes.map((r) => (
                <li key={r.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-700">Devolução · {r.ppeItem.nome}</span>
                    <Badge tone="neutral">{r.motivo}</Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    {new Date(r.dataDevolucao).toLocaleDateString("pt-BR")} · Estado: {r.estado} · Retornou ao estoque: {r.retornouEstoque ? "Sim" : "Não"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
