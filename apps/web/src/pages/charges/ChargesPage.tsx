import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FileSpreadsheet, FileDown, Check, Ban, HandCoins } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi, openPdfFromApi } from "../../lib/download";
import { EmployeeCharge, ChargeResumo, Page, Employee, PpeItem } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Select, Textarea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Badge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { Pagination } from "../../components/ui/Pagination";
import { BranchFilter } from "../../components/BranchFilter";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";

type ChargesResponse = Page<EmployeeCharge> & { resumo: ChargeResumo[] };

type FormData = {
  employeeId: string;
  ppeItemId: string;
  quantidade: number;
  valorUnitario?: string;
  motivo: string;
  competencia?: string;
  observacoes?: string;
};

type AcaoStatus = { charge: EmployeeCharge; status: "DESCONTADO" | "PERDOADO" | "CANCELADO" };

const motivoLabels: Record<string, string> = {
  DANIFICACAO: "Danificação",
  PERDA: "Perda",
  NAO_DEVOLVIDO: "Não devolvido",
  MAU_USO: "Mau uso",
  OUTRO: "Outro",
};

const statusTone: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  PENDENTE: "warning",
  DESCONTADO: "success",
  PERDOADO: "neutral",
  CANCELADO: "danger",
};

const statusLabels: Record<string, string> = {
  PENDENTE: "Pendente",
  DESCONTADO: "Descontado",
  PERDOADO: "Perdoado",
  CANCELADO: "Cancelado",
};

const moeda = (valor: string | number) =>
  Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ChargesPage() {
  const { canWrite, isAdmin } = usePermissions();
  const canEdit = canWrite(["ALMOXARIFADO"]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [branchId, setBranchId] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [acao, setAcao] = useState<AcaoStatus | null>(null);
  const [competenciaAcao, setCompetenciaAcao] = useState("");
  const [motivoAcao, setMotivoAcao] = useState("");
  const queryClient = useQueryClient();

  const filtros = { page, ...(status ? { status } : {}), ...(branchId ? { branchId } : {}), ...(competencia ? { competencia } : {}) };

  const { data, isLoading } = useQuery<ChargesResponse>({
    queryKey: ["charges", filtros],
    queryFn: async () => (await api.get("/charges", { params: filtros })).data,
  });
  const { data: employees } = useQuery<Page<Employee>>({
    queryKey: ["employees", "all"],
    queryFn: async () => (await api.get("/employees", { params: { pageSize: 200, status: "ATIVO" } })).data,
  });
  const { data: ppeItems } = useQuery<Page<PpeItem>>({
    queryKey: ["ppe-items", "all"],
    queryFn: async () => (await api.get("/ppe-items", { params: { pageSize: 200 } })).data,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) =>
      api.post("/charges", {
        ...values,
        valorUnitario: values.valorUnitario ? Number(values.valorUnitario) : undefined,
        competencia: values.competencia || undefined,
      }),
    onSuccess: () => {
      toast.success("Cobrança lançada com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["charges"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ charge, status: novoStatus }: AcaoStatus) =>
      api.patch(`/charges/${charge.id}/status`, {
        status: novoStatus,
        competencia: competenciaAcao || undefined,
        motivo: motivoAcao || undefined,
      }),
    onSuccess: () => {
      toast.success("Cobrança atualizada.");
      queryClient.invalidateQueries({ queryKey: ["charges"] });
      setAcao(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    reset({
      employeeId: "",
      ppeItemId: "",
      quantidade: 1,
      valorUnitario: "",
      motivo: "DANIFICACAO",
      competencia: new Date().toISOString().slice(0, 7),
      observacoes: "",
    });
    setModalOpen(true);
  }

  function abrirAcao(charge: EmployeeCharge, novoStatus: AcaoStatus["status"]) {
    setCompetenciaAcao(charge.competencia ?? new Date().toISOString().slice(0, 7));
    setMotivoAcao("");
    setAcao({ charge, status: novoStatus });
  }

  const totalPendente = data?.resumo.find((r) => r.status === "PENDENTE");
  const totalDescontado = data?.resumo.find((r) => r.status === "DESCONTADO");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Cobranças de EPI</h1>
          <p className="text-sm text-slate-500">
            Valores a descontar do colaborador por EPI danificado, perdido ou não devolvido. O valor vem do custo da nota
            fiscal registrada na filial.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              downloadFromApi(
                "/charges/export/xlsx",
                { ...(status ? { status } : {}), ...(branchId ? { branchId } : {}), ...(competencia ? { competencia } : {}) },
                "cobrancas-epi.xlsx"
              )
            }
          >
            <FileSpreadsheet className="h-4 w-4" /> Excel para o RH
          </Button>
          {canEdit && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Nova cobrança
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="flex items-center gap-3 p-4">
            <span className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <HandCoins className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">A descontar</p>
              <p className="text-lg font-semibold text-slate-800">{moeda(totalPendente?.valor ?? 0)}</p>
              <p className="text-xs text-slate-400">{totalPendente?.quantidade ?? 0} cobrança(s) pendente(s)</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3 p-4">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <Check className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Já descontado</p>
              <p className="text-lg font-semibold text-slate-800">{moeda(totalDescontado?.valor ?? 0)}</p>
              <p className="text-xs text-slate-400">{totalDescontado?.quantidade ?? 0} cobrança(s)</p>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Cobranças lançadas"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <BranchFilter value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} />
              <Input
                type="month"
                className="w-40"
                value={competencia}
                onChange={(e) => { setCompetencia(e.target.value); setPage(1); }}
              />
              <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">Todos os status</option>
                <option value="PENDENTE">Pendentes</option>
                <option value="DESCONTADO">Descontadas</option>
                <option value="PERDOADO">Perdoadas</option>
                <option value="CANCELADO">Canceladas</option>
              </Select>
            </div>
          }
        />
        <DataTable
          columns={[
            { header: "Data", cell: (r) => new Date(r.createdAt).toLocaleDateString("pt-BR") },
            { header: "Colaborador", cell: (r) => (
                <div>
                  <p className="font-medium text-slate-700">{r.employee.nomeCompleto}</p>
                  <p className="text-xs text-slate-400">{r.employee.matricula} · {r.branch?.nome ?? "-"}</p>
                </div>
              ),
            },
            { header: "EPI", cell: (r) => (
                <div>
                  <p>{r.ppeItem.nome}</p>
                  {r.ppeItem.ca && <p className="text-xs text-slate-400">CA {r.ppeItem.ca}</p>}
                </div>
              ),
            },
            { header: "Motivo", cell: (r) => motivoLabels[r.motivo] ?? r.motivo },
            { header: "Qtd", cell: (r) => r.quantidade },
            { header: "Valor unit.", cell: (r) => moeda(r.valorUnitario) },
            { header: "Total", cell: (r) => <span className="font-semibold text-slate-800">{moeda(r.valorTotal)}</span> },
            { header: "Competência", cell: (r) => r.competencia ?? "-" },
            { header: "Status", cell: (r) => <Badge tone={statusTone[r.status]}>{statusLabels[r.status]}</Badge> },
            {
              header: "",
              cell: (r) => (
                <div className="flex flex-wrap justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openPdfFromApi(`/charges/${r.id}/termo.pdf`, `termo-cobranca-${r.id}.pdf`)}>
                    <FileDown className="h-3.5 w-3.5" /> Termo
                  </Button>
                  {r.status === "PENDENTE" && canEdit && (
                    <Button variant="outline" size="sm" onClick={() => abrirAcao(r, "DESCONTADO")}>
                      <Check className="h-3.5 w-3.5" /> Descontar
                    </Button>
                  )}
                  {r.status === "PENDENTE" && isAdmin && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => abrirAcao(r, "PERDOADO")}>
                        Perdoar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => abrirAcao(r, "CANCELADO")}>
                        <Ban className="h-3.5 w-3.5" /> Cancelar
                      </Button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(r) => r.id}
          emptyTitle="Nenhuma cobrança lançada"
          emptyDescription="Cobranças aparecem aqui ao registrar uma devolução com EPI danificado ou inutilizável."
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nova cobrança"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>Lançar cobrança</Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && (
            <div className="sm:col-span-2">
              <InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner>
            </div>
          )}
          <Select label="Colaborador" required error={formState.errors.employeeId?.message} {...register("employeeId", { required: "Obrigatório." })}>
            <option value="">Selecione...</option>
            {employees?.items.map((e) => (
              <option key={e.id} value={e.id}>{e.nomeCompleto}</option>
            ))}
          </Select>
          <Select label="EPI" required error={formState.errors.ppeItemId?.message} {...register("ppeItemId", { required: "Obrigatório." })}>
            <option value="">Selecione...</option>
            {ppeItems?.items.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </Select>
          <Select label="Motivo" required {...register("motivo", { required: true })}>
            <option value="DANIFICACAO">Danificação</option>
            <option value="PERDA">Perda</option>
            <option value="NAO_DEVOLVIDO">Não devolvido</option>
            <option value="MAU_USO">Mau uso</option>
            <option value="OUTRO">Outro</option>
          </Select>
          <Input label="Quantidade" type="number" min={1} required {...register("quantidade", { required: true, valueAsNumber: true, min: 1 })} />
          <Input
            label="Valor unitário (R$)"
            type="number"
            step="0.01"
            min={0}
            hint="Em branco, usa o custo da nota fiscal registrada na filial."
            {...register("valorUnitario")}
          />
          <Input label="Competência do desconto" type="month" hint="Mês da folha em que será descontado." {...register("competencia")} />
          <div className="sm:col-span-2">
            <Textarea label="Observações" {...register("observacoes")} />
          </div>
        </form>
      </Modal>

      <Modal
        open={!!acao}
        onClose={() => setAcao(null)}
        title={
          acao?.status === "DESCONTADO"
            ? "Confirmar desconto em folha"
            : acao?.status === "PERDOADO"
              ? "Perdoar cobrança"
              : "Cancelar cobrança"
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setAcao(null)}>Voltar</Button>
            <Button
              loading={statusMutation.isPending}
              variant={acao?.status === "DESCONTADO" ? "primary" : "danger"}
              onClick={() => acao && statusMutation.mutate(acao)}
            >
              Confirmar
            </Button>
          </>
        }
      >
        {acao && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              <strong>{acao.charge.employee.nomeCompleto}</strong> — {acao.charge.ppeItem.nome} ·{" "}
              <strong>{moeda(acao.charge.valorTotal)}</strong>
            </p>
            {statusMutation.isError && <InlineBanner tone="error">{extractErrorMessage(statusMutation.error)}</InlineBanner>}
            {acao.status === "DESCONTADO" && (
              <>
                <p>Confirme a competência em que o valor foi enviado ao RH para desconto em folha.</p>
                <Input
                  label="Competência"
                  type="month"
                  required
                  value={competenciaAcao}
                  onChange={(e) => setCompetenciaAcao(e.target.value)}
                />
              </>
            )}
            {acao.status === "PERDOADO" && (
              <>
                <p>A empresa assume o prejuízo e o colaborador não será descontado. Esta ação fica registrada na auditoria.</p>
                <Textarea
                  label="Motivo do perdão"
                  required
                  hint="Mínimo de 5 caracteres."
                  value={motivoAcao}
                  onChange={(e) => setMotivoAcao(e.target.value)}
                />
              </>
            )}
            {acao.status === "CANCELADO" && (
              <>
                <p>A cobrança será cancelada por erro de lançamento. Esta ação fica registrada na auditoria.</p>
                <Textarea
                  label="Justificativa"
                  value={motivoAcao}
                  onChange={(e) => setMotivoAcao(e.target.value)}
                />
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
