import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power, FileDown, FileSpreadsheet, Upload } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { PpeItem, Page, PpeCategory } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StatusBadge, Badge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { Pagination } from "../../components/ui/Pagination";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";
import { ImportExcelModal } from "../../components/ImportExcelModal";
import { useBranches } from "../../hooks/useBranches";

type FormData = {
  nome: string;
  codigoInterno: string;
  exigeCa: boolean;
  ca: string;
  caValidade: string;
  categoryId: string;
  fabricante?: string;
  modelo?: string;
  unidade: string;
  vidaUtilDias: number;
  estoqueMinimo: number;
  estoqueMaximo: number;
  custoUnitario: number;
  estoqueInicial?: number;
  branchId?: string;
  descricao?: string;
};

export default function PpeItemsPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["SEGURANCA_TRABALHO", "ALMOXARIFADO"]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<PpeItem | null>(null);
  const [toggling, setToggling] = useState<PpeItem | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Page<PpeItem>>({
    queryKey: ["ppe-items", page, search],
    queryFn: async () => (await api.get("/ppe-items", { params: { page, search } })).data,
  });
  const { data: categories } = useQuery<PpeCategory[]>({
    queryKey: ["ppe-categories"],
    queryFn: async () => (await api.get("/ppe-categories", { params: { status: "ATIVO" } })).data,
  });
  const { data: branches } = useBranches();

  const { register, handleSubmit, reset, formState, watch } = useForm<FormData>();
  // Uniforme (camisa, calça) não tem Certificado de Aprovação: os campos de CA somem.
  const exigeCa = watch("exigeCa");

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) => {
      const payload = values.exigeCa ? values : { ...values, ca: null, caValidade: null };
      return editing ? api.put(`/ppe-items/${editing.id}`, payload) : api.post("/ppe-items", payload);
    },
    onSuccess: () => {
      toast.success(editing ? "EPI atualizado com sucesso." : "EPI criado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["ppe-items"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: PpeItem) =>
      api.patch(`/ppe-items/${item.id}/status`, { status: item.status === "ATIVO" ? "INATIVO" : "ATIVO" }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["ppe-items"] });
      setToggling(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({
      nome: "",
      codigoInterno: "",
      exigeCa: true,
      ca: "",
      caValidade: "",
      categoryId: "",
      unidade: "UN",
      vidaUtilDias: 365,
      estoqueMinimo: 0,
      estoqueMaximo: 0,
      custoUnitario: 0,
      estoqueInicial: 0,
      branchId: branches?.length === 1 ? branches[0].id : "",
      descricao: "",
    });
    setModalOpen(true);
  }

  function openEdit(item: PpeItem) {
    setEditing(item);
    reset({
      nome: item.nome,
      codigoInterno: item.codigoInterno,
      exigeCa: item.exigeCa,
      ca: item.ca ?? "",
      caValidade: item.caValidade ? item.caValidade.slice(0, 10) : "",
      categoryId: item.categoryId,
      fabricante: item.fabricante ?? "",
      modelo: item.modelo ?? "",
      unidade: item.unidade,
      vidaUtilDias: item.vidaUtilDias,
      estoqueMinimo: item.estoqueMinimo,
      estoqueMaximo: item.estoqueMaximo,
      custoUnitario: Number(item.custoUnitario),
      descricao: item.descricao ?? "",
    });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">EPIs</h1>
          <p className="text-sm text-slate-500">Catálogo de Equipamentos de Proteção Individual.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/estoque", { format: "xlsx" }, "epis.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/estoque", { format: "pdf" }, "epis.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Importar</Button>
              <Button onClick={openCreate}><Plus className="h-4 w-4" /> Novo EPI</Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Catálogo de EPIs"
          actions={<Input placeholder="Buscar nome, código, CA..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-64" />}
        />
        <DataTable
          columns={[
            { header: "Nome", cell: (i) => <span className="font-medium text-slate-700">{i.nome}</span> },
            { header: "Código", cell: (i) => i.codigoInterno },
            { header: "Categoria", cell: (i) => i.category?.nome ?? "-" },
            {
              header: "CA",
              cell: (i) =>
                !i.exigeCa ? (
                  <span className="text-xs text-slate-400">Sem CA (uniforme)</span>
                ) : (
                  <div className="flex items-center gap-2">
                    {i.ca}{" "}
                    {i.caStatus && (
                      <Badge tone={i.caStatus === "VENCIDO" ? "danger" : i.caStatus === "PROXIMO_VENCIMENTO" ? "warning" : "success"}>
                        {i.caStatus === "VENCIDO" ? "Vencido" : i.caStatus === "PROXIMO_VENCIMENTO" ? "Próx. vencimento" : "Válido"}
                      </Badge>
                    )}
                  </div>
                ),
            },
            {
              header: "Estoque total",
              cell: (i) => (
                <div className="flex items-center gap-2">
                  {i.estoqueTotal ?? 0} {i.stockStatus && <StatusBadge status={i.stockStatus} />}
                </div>
              ),
            },
            { header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
            {
              header: "",
              cell: (i) =>
                canEdit && (
                  <div className="flex justify-end gap-1">
                    <Button title="Editar EPI" variant="ghost" size="sm" onClick={() => openEdit(i)}><Pencil className="h-4 w-4" /></Button>
                    <Button title="Ativar ou inativar EPI" variant="ghost" size="sm" onClick={() => setToggling(i)}><Power className="h-4 w-4" /></Button>
                  </div>
                ),
              className: "text-right",
            },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(i) => i.id}
          emptyTitle="Nenhum EPI cadastrado"
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar EPI" : "Novo EPI"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>Salvar</Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && (
            <div className="sm:col-span-2"><InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner></div>
          )}
          <div className="sm:col-span-2">
            <Input label="Nome" required error={formState.errors.nome?.message} {...register("nome", { required: "Obrigatório." })} />
          </div>
          <Input label="Código interno" required error={formState.errors.codigoInterno?.message} {...register("codigoInterno", { required: "Obrigatório." })} />
          <Select label="Categoria" required error={formState.errors.categoryId?.message} {...register("categoryId", { required: "Obrigatório." })}>
            <option value="">Selecione...</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4" {...register("exigeCa")} />
              <span>
                <strong>Este item tem Certificado de Aprovação (CA)</strong>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Desmarque para uniformes e vestuário sem CA — camisa, calça, jaqueta. O item continua tendo estoque
                  por filial, matriz por cargo, entrega com confirmação e termo; só não é controlado por validade de CA.
                </span>
              </span>
            </label>
          </div>
          {exigeCa && (
            <>
              <Input label="CA" required error={formState.errors.ca?.message} {...register("ca", { required: "Obrigatório." })} />
              <Input label="Validade do CA" type="date" required error={formState.errors.caValidade?.message} {...register("caValidade", { required: "Obrigatório." })} />
            </>
          )}
          <Input label="Fabricante" {...register("fabricante")} />
          <Input label="Modelo" {...register("modelo")} />
          <Input label="Unidade" required {...register("unidade", { required: true })} />
          <Input label="Vida útil (dias)" type="number" required error={formState.errors.vidaUtilDias?.message} {...register("vidaUtilDias", { required: "Obrigatório.", valueAsNumber: true, min: 1 })} />
          <div className="sm:col-span-2">
            <InlineBanner tone="info">
              Estoque mínimo, máximo e custo abaixo são apenas os <strong>valores padrão</strong> usados quando este EPI
              entra numa filial nova. Os números reais de cada filial ficam na tela de Estoque.
            </InlineBanner>
          </div>
          <Input label="Estoque mínimo padrão" type="number" required {...register("estoqueMinimo", { required: true, valueAsNumber: true, min: 0 })} />
          <Input label="Estoque máximo padrão" type="number" required {...register("estoqueMaximo", { required: true, valueAsNumber: true, min: 0 })} />
          <Input label="Custo unitário padrão (R$)" type="number" step="0.01" required {...register("custoUnitario", { required: true, valueAsNumber: true, min: 0 })} />
          {!editing && (
            <>
              <Input
                label="Estoque inicial"
                type="number"
                hint="Quantidade já existente no estoque ao cadastrar"
                {...register("estoqueInicial", { valueAsNumber: true, min: 0 })}
              />
              <Select label="Filial do estoque inicial" hint="Obrigatório se informar estoque inicial" {...register("branchId")}>
                <option value="">Selecione...</option>
                {branches?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </Select>
            </>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.status === "ATIVO" ? "Inativar EPI" : "Reativar EPI"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} o EPI "${toggling?.nome}"? EPIs inativos não podem ser entregues.`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />

      <ImportExcelModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        type="ppeItems"
        invalidateKey="ppe-items"
        columnsHint="nome, codigoInterno, ca, caValidade, categoria, fabricante, modelo, unidade, vidaUtilDias, estoqueMinimo, estoqueMaximo, custoUnitario — deixe ca e caValidade em branco para uniformes sem CA (camisa, calça)"
      />
    </div>
  );
}
