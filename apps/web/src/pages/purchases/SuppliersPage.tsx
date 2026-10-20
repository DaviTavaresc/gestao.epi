import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power, FileDown, FileSpreadsheet } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Supplier, Page } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StatusBadge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { Pagination } from "../../components/ui/Pagination";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";

type FormData = { razaoSocial: string; nomeFantasia?: string; cnpj: string; telefone?: string; email?: string; endereco?: string; observacoes?: string };

export default function SuppliersPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["ALMOXARIFADO"]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [toggling, setToggling] = useState<Supplier | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Page<Supplier>>({
    queryKey: ["suppliers", page, search],
    queryFn: async () => (await api.get("/suppliers", { params: { page, search } })).data,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) => (editing ? api.put(`/suppliers/${editing.id}`, values) : api.post("/suppliers", values)),
    onSuccess: () => {
      toast.success(editing ? "Fornecedor atualizado com sucesso." : "Fornecedor criado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (supplier: Supplier) => api.patch(`/suppliers/${supplier.id}/status`, { status: supplier.status === "ATIVO" ? "INATIVO" : "ATIVO" }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setToggling(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({ razaoSocial: "", nomeFantasia: "", cnpj: "", telefone: "", email: "", endereco: "", observacoes: "" });
    setModalOpen(true);
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier);
    reset({
      razaoSocial: supplier.razaoSocial,
      nomeFantasia: supplier.nomeFantasia ?? "",
      cnpj: supplier.cnpj,
      telefone: supplier.telefone ?? "",
      email: supplier.email ?? "",
      endereco: supplier.endereco ?? "",
      observacoes: supplier.observacoes ?? "",
    });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Fornecedores</h1>
          <p className="text-sm text-slate-500">Gerencie os fornecedores de EPIs da empresa.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/fornecedores", { format: "xlsx" }, "fornecedores.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/fornecedores", { format: "pdf" }, "fornecedores.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {canEdit && <Button onClick={openCreate}><Plus className="h-4 w-4" /> Novo fornecedor</Button>}
        </div>
      </div>

      <Card>
        <CardHeader title="Lista de fornecedores" actions={<Input placeholder="Buscar razão social, CNPJ..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-64" />} />
        <DataTable
          columns={[
            { header: "Razão social", cell: (s) => <span className="font-medium text-slate-700">{s.razaoSocial}</span> },
            { header: "CNPJ", cell: (s) => s.cnpj },
            { header: "Telefone", cell: (s) => s.telefone || "-" },
            { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
            {
              header: "",
              cell: (s) =>
                canEdit && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setToggling(s)}><Power className="h-4 w-4" /></Button>
                  </div>
                ),
              className: "text-right",
            },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(s) => s.id}
          emptyTitle="Nenhum fornecedor cadastrado"
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar fornecedor" : "Novo fornecedor"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>Salvar</Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && <div className="sm:col-span-2"><InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner></div>}
          <Input label="Razão social" required error={formState.errors.razaoSocial?.message} {...register("razaoSocial", { required: "Obrigatório." })} />
          <Input label="Nome fantasia" {...register("nomeFantasia")} />
          <Input label="CNPJ" required error={formState.errors.cnpj?.message} {...register("cnpj", { required: "Obrigatório." })} />
          <Input label="Telefone" {...register("telefone")} />
          <Input label="E-mail" type="email" {...register("email")} />
          <Input label="Endereço" {...register("endereco")} />
          <div className="sm:col-span-2"><Textarea label="Observações" {...register("observacoes")} /></div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.status === "ATIVO" ? "Inativar fornecedor" : "Reativar fornecedor"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} "${toggling?.razaoSocial}"?`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
