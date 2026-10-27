import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, FileDown, FileSpreadsheet } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Purchase, Page, Supplier, PpeItem } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Select, Textarea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { StatusBadge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { Pagination } from "../../components/ui/Pagination";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";
import { BranchFilter } from "../../components/BranchFilter";
import { useBranches } from "../../hooks/useBranches";

type FormData = {
  branchId: string;
  numeroNf: string;
  supplierId: string;
  dataCompra: string;
  observacoes?: string;
  items: { ppeItemId: string; quantidade: number; valorUnitario: number }[];
};

export default function PurchasesListPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["ALMOXARIFADO"]);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: branches } = useBranches();

  const { data, isLoading } = useQuery<Page<Purchase>>({
    queryKey: ["purchases", page, branchId],
    queryFn: async () => (await api.get("/purchases", { params: { page, branchId: branchId || undefined } })).data,
  });
  const { data: suppliers } = useQuery<Page<Supplier>>({
    queryKey: ["suppliers", "all"],
    queryFn: async () => (await api.get("/suppliers", { params: { pageSize: 100, status: "ATIVO" } })).data,
  });
  const { data: ppeItems } = useQuery<Page<PpeItem>>({
    queryKey: ["ppe-items", "all"],
    queryFn: async () => (await api.get("/ppe-items", { params: { pageSize: 200, status: "ATIVO" } })).data,
  });

  const { register, control, handleSubmit, reset, formState, watch } = useForm<FormData>({
    defaultValues: { items: [{ ppeItemId: "", quantidade: 1, valorUnitario: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const items = watch("items");
  const total = items?.reduce((acc, i) => acc + (Number(i.quantidade) || 0) * (Number(i.valorUnitario) || 0), 0) ?? 0;

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) => api.post("/purchases", values),
    onSuccess: (res) => {
      toast.success("Compra criada com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      setModalOpen(false);
      navigate(`/compras/${res.data.id}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    reset({
      branchId: branches?.length === 1 ? branches[0].id : "",
      numeroNf: "",
      supplierId: "",
      dataCompra: "",
      observacoes: "",
      items: [{ ppeItemId: "", quantidade: 1, valorUnitario: 0 }],
    });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Compras</h1>
          <p className="text-sm text-slate-500">Registre compras e dê entrada no estoque ao recebê-las.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/compras", { format: "xlsx" }, "compras.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/compras", { format: "pdf" }, "compras.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {canEdit && <Button onClick={openCreate}><Plus className="h-4 w-4" /> Nova compra</Button>}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Lista de compras"
          actions={<BranchFilter value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} />}
        />
        <DataTable
          columns={[
            { header: "NF", cell: (p) => <span className="font-medium text-slate-700">{p.numeroNf}</span> },
            { header: "Filial", cell: (p) => p.branch?.nome ?? "-" },
            { header: "Fornecedor", cell: (p) => p.supplier.razaoSocial },
            { header: "Data", cell: (p) => new Date(p.dataCompra).toLocaleDateString("pt-BR") },
            { header: "Valor total", cell: (p) => `R$ ${Number(p.valorTotal).toFixed(2)}` },
            { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(p) => p.id}
          emptyTitle="Nenhuma compra registrada"
          onRowClick={(p) => navigate(`/compras/${p.id}`)}
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nova compra"
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>Criar compra</Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && <InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Filial de destino"
              required
              hint="A entrada de estoque será feita nesta filial"
              error={formState.errors.branchId?.message}
              {...register("branchId", { required: "Obrigatório." })}
            >
              <option value="">Selecione...</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </Select>
            <Input label="Número da NF" required error={formState.errors.numeroNf?.message} {...register("numeroNf", { required: "Obrigatório." })} />
            <Select label="Fornecedor" required error={formState.errors.supplierId?.message} {...register("supplierId", { required: "Obrigatório." })}>
              <option value="">Selecione...</option>
              {suppliers?.items.map((s) => <option key={s.id} value={s.id}>{s.razaoSocial}</option>)}
            </Select>
            <Input label="Data da compra" type="date" required error={formState.errors.dataCompra?.message} {...register("dataCompra", { required: "Obrigatório." })} />
          </div>
          <Textarea label="Observações" {...register("observacoes")} />

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Itens da compra</p>
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-end gap-2">
                  <Select className="flex-[2]" {...register(`items.${index}.ppeItemId`, { required: true })}>
                    <option value="">Selecione o EPI...</option>
                    {ppeItems?.items.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </Select>
                  <Input className="w-24" type="number" min={1} placeholder="Qtd" {...register(`items.${index}.quantidade`, { required: true, valueAsNumber: true, min: 1 })} />
                  <Input className="w-32" type="number" step="0.01" min={0} placeholder="Valor unit." {...register(`items.${index}.valorUnitario`, { required: true, valueAsNumber: true, min: 0 })} />
                  <Button title="Remover este item da compra" type="button" variant="ghost" size="sm" onClick={() => remove(index)} disabled={fields.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => append({ ppeItemId: "", quantidade: 1, valorUnitario: 0 })}>
              <Plus className="h-4 w-4" /> Adicionar item
            </Button>
            <p className="mt-3 text-right text-sm font-semibold text-slate-700">Total: R$ {total.toFixed(2)}</p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
