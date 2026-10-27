import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, FileDown, FileSpreadsheet, PackagePlus } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { BranchStock, PpeItem, Page } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Select, Textarea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { StatusBadge, Badge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";
import { BranchFilter } from "../../components/BranchFilter";
import { useBranches } from "../../hooks/useBranches";

type FormData = { tipo: string; quantidade: number; motivo: string };
type LimitsFormData = { estoqueMinimo: number; estoqueMaximo: number; custoUnitario: number };
type NovoItemFormData = {
  branchId: string;
  ppeItemId: string;
  quantidade: number;
  estoqueMinimo: number;
  estoqueMaximo: number;
};

export default function StockCurrentPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["ALMOXARIFADO"]);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("");
  const [adjusting, setAdjusting] = useState<BranchStock | null>(null);
  const [editingLimits, setEditingLimits] = useState<BranchStock | null>(null);
  const [novoItemOpen, setNovoItemOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: branches } = useBranches();

  const { data, isLoading } = useQuery<BranchStock[]>({
    queryKey: ["stock-current", search, branchId],
    queryFn: async () => (await api.get("/stock/current", { params: { search, branchId: branchId || undefined } })).data,
  });

  // Catálogo completo: permite colocar no estoque da filial um EPI que ela ainda não tem.
  const { data: ppeItems } = useQuery<Page<PpeItem>>({
    queryKey: ["ppe-items", "catalogo"],
    queryFn: async () => (await api.get("/ppe-items", { params: { pageSize: 200, status: "ATIVO" } })).data,
    enabled: novoItemOpen,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();
  const limitsForm = useForm<LimitsFormData>();
  const novoItemForm = useForm<NovoItemFormData>();

  const adjustMutation = useMutation({
    mutationFn: async (values: FormData) =>
      api.post("/stock/movements", {
        ...values,
        ppeItemId: adjusting!.ppeItem.id,
        branchId: adjusting!.branch.id,
      }),
    onSuccess: () => {
      toast.success("Movimentação registrada com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["stock-current"] });
      setAdjusting(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  // Define os limites (cria o registro de estoque na filial) e, se informada,
  // lança a quantidade inicial como ajuste positivo — gerando movimentação rastreável.
  const novoItemMutation = useMutation({
    mutationFn: async (values: NovoItemFormData) => {
      await api.put("/stock/limits", {
        branchId: values.branchId,
        ppeItemId: values.ppeItemId,
        estoqueMinimo: values.estoqueMinimo,
        estoqueMaximo: values.estoqueMaximo,
      });
      if (values.quantidade > 0) {
        await api.post("/stock/movements", {
          branchId: values.branchId,
          ppeItemId: values.ppeItemId,
          tipo: "AJUSTE_POSITIVO",
          quantidade: values.quantidade,
          motivo: "Entrada inicial do EPI no estoque desta filial",
        });
      }
    },
    onSuccess: () => {
      toast.success("EPI adicionado ao estoque da filial.");
      queryClient.invalidateQueries({ queryKey: ["stock-current"] });
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      setNovoItemOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const limitsMutation = useMutation({
    mutationFn: async (values: LimitsFormData) =>
      api.put("/stock/limits", {
        ...values,
        ppeItemId: editingLimits!.ppeItem.id,
        branchId: editingLimits!.branch.id,
      }),
    onSuccess: () => {
      toast.success("Limites de estoque atualizados.");
      queryClient.invalidateQueries({ queryKey: ["stock-current"] });
      setEditingLimits(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Estoque atual</h1>
          <p className="text-sm text-slate-500">Saldos de EPI por filial — cada unidade tem seu próprio almoxarifado.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => downloadFromApi("/reports/estoque", { format: "xlsx", branchId: branchId || undefined }, "estoque.xlsx")}
          >
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => downloadFromApi("/reports/estoque", { format: "pdf", branchId: branchId || undefined }, "estoque.pdf")}
          >
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {canEdit && (
            <Button
              onClick={() => {
                novoItemForm.reset({
                  branchId: branchId || (branches?.length === 1 ? branches[0].id : ""),
                  ppeItemId: "",
                  quantidade: 0,
                  estoqueMinimo: 0,
                  estoqueMaximo: 0,
                });
                setNovoItemOpen(true);
              }}
            >
              <PackagePlus className="h-4 w-4" /> Adicionar EPI ao estoque
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="EPIs em estoque"
          actions={
            <div className="flex gap-2">
              <BranchFilter value={branchId} onChange={setBranchId} />
              <Input placeholder="Buscar EPI..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
            </div>
          }
        />
        <DataTable
          columns={[
            { header: "Filial", cell: (s) => <span className="font-medium text-navy-700">{s.branch.nome}</span> },
            { header: "EPI", cell: (s) => <span className="font-medium text-slate-700">{s.ppeItem.nome}</span> },
            { header: "Categoria", cell: (s) => s.ppeItem.category?.nome ?? "-" },
            { header: "Atual", cell: (s) => s.estoqueAtual },
            { header: "Mínimo", cell: (s) => s.estoqueMinimo },
            { header: "Máximo", cell: (s) => s.estoqueMaximo },
            { header: "Custo unit.", cell: (s) => `R$ ${Number(s.custoUnitario).toFixed(2)}` },
            {
              header: "CA",
              cell: (s) =>
                s.caStatus === "NAO_APLICAVEL" || !s.ppeItem.ca ? (
                  <span className="text-xs text-slate-400">—</span>
                ) : (
                  s.caStatus && (
                    <Badge tone={s.caStatus === "VENCIDO" ? "danger" : s.caStatus === "PROXIMO_VENCIMENTO" ? "warning" : "success"}>
                      {s.ppeItem.ca}
                    </Badge>
                  )
                ),
            },
            { header: "Status", cell: (s) => s.stockStatus && <StatusBadge status={s.stockStatus} /> },
            {
              header: "",
              cell: (s) =>
                canEdit && (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        reset({ tipo: "AJUSTE_POSITIVO", quantidade: 1, motivo: "" });
                        setAdjusting(s);
                      }}
                    >
                      <SlidersHorizontal className="h-4 w-4" /> Ajustar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        limitsForm.reset({
                          estoqueMinimo: s.estoqueMinimo,
                          estoqueMaximo: s.estoqueMaximo,
                          custoUnitario: Number(s.custoUnitario),
                        });
                        setEditingLimits(s);
                      }}
                    >
                      Parâmetros
                    </Button>
                  </div>
                ),
              className: "text-right",
            },
          ]}
          rows={data ?? []}
          loading={isLoading}
          rowKey={(s) => s.id}
          emptyTitle="Nenhum EPI em estoque nesta filial"
          emptyDescription='Use "Adicionar EPI ao estoque" para a primeira entrada, ou registre uma compra para esta filial.'
        />
      </Card>

      <Modal
        open={novoItemOpen}
        onClose={() => setNovoItemOpen(false)}
        title="Adicionar EPI ao estoque da filial"
        footer={
          <>
            <Button variant="outline" onClick={() => setNovoItemOpen(false)}>
              Cancelar
            </Button>
            <Button loading={novoItemMutation.isPending} onClick={novoItemForm.handleSubmit((v) => novoItemMutation.mutate(v))}>
              Adicionar
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={novoItemForm.handleSubmit((v) => novoItemMutation.mutate(v))}>
          {novoItemMutation.isError && <InlineBanner tone="error">{extractErrorMessage(novoItemMutation.error)}</InlineBanner>}
          <Select
            label="Filial"
            required
            error={novoItemForm.formState.errors.branchId?.message}
            {...novoItemForm.register("branchId", { required: "Obrigatório." })}
          >
            <option value="">Selecione...</option>
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </Select>
          <Select
            label="EPI"
            required
            error={novoItemForm.formState.errors.ppeItemId?.message}
            {...novoItemForm.register("ppeItemId", { required: "Obrigatório." })}
          >
            <option value="">Selecione...</option>
            {ppeItems?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} ({p.codigoInterno})
              </option>
            ))}
          </Select>
          <Input
            label="Quantidade inicial"
            type="number"
            min={0}
            hint="Gera uma movimentação de ajuste positivo. Deixe 0 para apenas cadastrar os limites."
            {...novoItemForm.register("quantidade", { valueAsNumber: true, min: 0 })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Estoque mínimo"
              type="number"
              min={0}
              {...novoItemForm.register("estoqueMinimo", { valueAsNumber: true, min: 0 })}
            />
            <Input
              label="Estoque máximo"
              type="number"
              min={0}
              {...novoItemForm.register("estoqueMaximo", { valueAsNumber: true, min: 0 })}
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={!!adjusting}
        onClose={() => setAdjusting(null)}
        title={`Ajustar estoque — ${adjusting?.ppeItem.nome}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjusting(null)}>
              Cancelar
            </Button>
            <Button loading={adjustMutation.isPending} onClick={handleSubmit((v) => adjustMutation.mutate(v))}>
              Registrar
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit((v) => adjustMutation.mutate(v))}>
          {adjustMutation.isError && <InlineBanner tone="error">{extractErrorMessage(adjustMutation.error)}</InlineBanner>}
          <p className="text-sm text-slate-500">
            Filial: <strong className="text-slate-700">{adjusting?.branch.nome}</strong> · Estoque atual: {adjusting?.estoqueAtual}
          </p>
          <Select label="Tipo de movimentação" required {...register("tipo", { required: true })}>
            <option value="AJUSTE_POSITIVO">Ajuste positivo (entrada)</option>
            <option value="AJUSTE_NEGATIVO">Ajuste negativo (saída)</option>
            <option value="PERDA">Perda</option>
            <option value="DANIFICACAO">Danificação</option>
            <option value="DESCARTE">Descarte</option>
          </Select>
          <Input
            label="Quantidade"
            type="number"
            min={1}
            required
            error={formState.errors.quantidade?.message}
            {...register("quantidade", { required: "Obrigatório.", valueAsNumber: true, min: 1 })}
          />
          <Textarea label="Motivo" required error={formState.errors.motivo?.message} {...register("motivo", { required: "Obrigatório." })} />
        </form>
      </Modal>

      <Modal
        open={!!editingLimits}
        onClose={() => setEditingLimits(null)}
        title={`Parâmetros na filial — ${editingLimits?.ppeItem.nome}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingLimits(null)}>
              Cancelar
            </Button>
            <Button loading={limitsMutation.isPending} onClick={limitsForm.handleSubmit((v) => limitsMutation.mutate(v))}>
              Salvar
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={limitsForm.handleSubmit((v) => limitsMutation.mutate(v))}>
          <p className="text-sm text-slate-500">
            Filial: <strong className="text-slate-700">{editingLimits?.branch.nome}</strong>
          </p>
          <Input
            label="Estoque mínimo"
            type="number"
            min={0}
            required
            {...limitsForm.register("estoqueMinimo", { required: true, valueAsNumber: true, min: 0 })}
          />
          <Input
            label="Estoque máximo"
            type="number"
            min={0}
            required
            {...limitsForm.register("estoqueMaximo", { required: true, valueAsNumber: true, min: 0 })}
          />
          <Input
            label="Custo unitário nesta filial (R$)"
            type="number"
            step="0.01"
            min={0}
            hint="Atualizado automaticamente ao receber uma compra nesta filial. Não afeta as demais."
            {...limitsForm.register("custoUnitario", { valueAsNumber: true, min: 0 })}
          />
        </form>
      </Modal>
    </div>
  );
}
