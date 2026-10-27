import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FileDown, FileSpreadsheet } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { PpeReturn, Page, Employee, PpeItem } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Select, Textarea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Badge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { Pagination } from "../../components/ui/Pagination";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";

type FormData = {
  employeeId: string;
  ppeItemId: string;
  quantidade: number;
  dataDevolucao: string;
  motivo: string;
  estado: string;
  observacoes?: string;
  gerarCobranca: boolean;
  valorUnitarioCobranca?: string;
  competenciaCobranca?: string;
};

export default function ReturnsPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["ALMOXARIFADO"]);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Page<PpeReturn>>({
    queryKey: ["returns", page],
    queryFn: async () => (await api.get("/returns", { params: { page } })).data,
  });
  const { data: employees } = useQuery<Page<Employee>>({
    queryKey: ["employees", "all"],
    queryFn: async () => (await api.get("/employees", { params: { pageSize: 200, status: "ATIVO" } })).data,
  });
  const { data: ppeItems } = useQuery<Page<PpeItem>>({
    queryKey: ["ppe-items", "all"],
    queryFn: async () => (await api.get("/ppe-items", { params: { pageSize: 200 } })).data,
  });

  const { register, handleSubmit, reset, formState, watch } = useForm<FormData>();
  const estadoSelecionado = watch("estado");
  // EPI danificado ou inutilizável não volta ao estoque: o prejuízo é cobrado do colaborador.
  const geraCobranca = estadoSelecionado === "DANIFICADO" || estadoSelecionado === "INUTILIZAVEL";

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) => {
      const cobravel = values.estado === "DANIFICADO" || values.estado === "INUTILIZAVEL";
      return api.post("/returns", {
        ...values,
        gerarCobranca: cobravel ? values.gerarCobranca : false,
        valorUnitarioCobranca:
          cobravel && values.gerarCobranca && values.valorUnitarioCobranca ? Number(values.valorUnitarioCobranca) : undefined,
        competenciaCobranca: cobravel && values.gerarCobranca ? values.competenciaCobranca || undefined : undefined,
      });
    },
    onSuccess: () => {
      toast.success("Devolução registrada com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["returns"] });
      queryClient.invalidateQueries({ queryKey: ["stock-current"] });
      queryClient.invalidateQueries({ queryKey: ["charges"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    reset({
      employeeId: "",
      ppeItemId: "",
      quantidade: 1,
      dataDevolucao: new Date().toISOString().slice(0, 10),
      motivo: "TROCA",
      estado: "BOM",
      observacoes: "",
      gerarCobranca: true,
      valorUnitarioCobranca: "",
      competenciaCobranca: new Date().toISOString().slice(0, 7),
    });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Devoluções</h1>
          <p className="text-sm text-slate-500">Registre devoluções de EPI e seu retorno ou não ao estoque.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/devolucoes", { format: "xlsx" }, "devolucoes.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/devolucoes", { format: "pdf" }, "devolucoes.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {canEdit && <Button onClick={openCreate}><Plus className="h-4 w-4" /> Nova devolução</Button>}
        </div>
      </div>

      <Card>
        <CardHeader title="Histórico de devoluções" />
        <DataTable
          columns={[
            { header: "Data", cell: (r) => new Date(r.dataDevolucao).toLocaleDateString("pt-BR") },
            { header: "Colaborador", cell: (r) => r.employee.nomeCompleto },
            { header: "EPI", cell: (r) => r.ppeItem.nome },
            { header: "Qtd", cell: (r) => r.quantidade },
            { header: "Motivo", cell: (r) => r.motivo },
            { header: "Estado", cell: (r) => <Badge tone={r.estado === "BOM" ? "success" : r.estado === "INUTILIZAVEL" ? "danger" : "warning"}>{r.estado}</Badge> },
            { header: "Retornou ao estoque", cell: (r) => (r.retornouEstoque ? "Sim" : "Não") },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(r) => r.id}
          emptyTitle="Nenhuma devolução registrada"
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nova devolução"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>Registrar</Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && <div className="sm:col-span-2"><InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner></div>}
          <Select label="Colaborador" required error={formState.errors.employeeId?.message} {...register("employeeId", { required: "Obrigatório." })}>
            <option value="">Selecione...</option>
            {employees?.items.map((e) => <option key={e.id} value={e.id}>{e.nomeCompleto}</option>)}
          </Select>
          <Select label="EPI" required error={formState.errors.ppeItemId?.message} {...register("ppeItemId", { required: "Obrigatório." })}>
            <option value="">Selecione...</option>
            {ppeItems?.items.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
          <Input label="Quantidade" type="number" min={1} required {...register("quantidade", { required: true, valueAsNumber: true, min: 1 })} />
          <Input label="Data da devolução" type="date" required {...register("dataDevolucao", { required: true })} />
          <Select label="Motivo" required {...register("motivo", { required: true })}>
            <option value="TROCA">Troca</option>
            <option value="DESLIGAMENTO">Desligamento</option>
            <option value="VENCIMENTO">Vencimento</option>
            <option value="DANIFICACAO">Danificação</option>
            <option value="APOSENTADORIA">Aposentadoria</option>
            <option value="OUTRO">Outro</option>
          </Select>
          <Select label="Estado do item" required {...register("estado", { required: true })}>
            <option value="BOM">Bom</option>
            <option value="REGULAR">Regular</option>
            <option value="DANIFICADO">Danificado</option>
            <option value="INUTILIZAVEL">Inutilizável</option>
          </Select>
          <div className="sm:col-span-2"><Textarea label="Observações" {...register("observacoes")} /></div>

          {geraCobranca && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:col-span-2">
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5 h-4 w-4" {...register("gerarCobranca")} />
                <span>
                  <strong>Cobrar o valor do colaborador</strong>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Este EPI não volta ao estoque. Marcado, o sistema lança uma cobrança para desconto em folha usando o
                    custo da nota fiscal da filial. Desmarque se o dano não foi de responsabilidade do colaborador
                    (desgaste natural, defeito de fábrica).
                  </span>
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Valor unitário (R$)"
                  type="number"
                  step="0.01"
                  min={0}
                  hint="Em branco, usa o custo da nota fiscal."
                  {...register("valorUnitarioCobranca")}
                />
                <Input label="Competência do desconto" type="month" {...register("competenciaCobranca")} />
              </div>
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}
