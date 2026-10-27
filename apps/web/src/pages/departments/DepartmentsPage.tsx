import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power, FileDown, FileSpreadsheet } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Department, Page } from "../../types";
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

type FormData = { nome: string; descricao?: string; responsavel?: string };

export default function DepartmentsPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["SEGURANCA_TRABALHO"]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [toggling, setToggling] = useState<Department | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Page<Department>>({
    queryKey: ["departments", page, search],
    queryFn: async () => (await api.get("/departments", { params: { page, search } })).data,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) =>
      editing ? api.put(`/departments/${editing.id}`, values) : api.post("/departments", values),
    onSuccess: () => {
      toast.success(editing ? "Setor atualizado com sucesso." : "Setor criado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (department: Department) =>
      api.patch(`/departments/${department.id}/status`, { status: department.status === "ATIVO" ? "INATIVO" : "ATIVO" }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      setToggling(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({ nome: "", descricao: "", responsavel: "" });
    setModalOpen(true);
  }

  function openEdit(department: Department) {
    setEditing(department);
    reset({ nome: department.nome, descricao: department.descricao ?? "", responsavel: department.responsavel ?? "" });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Setores</h1>
          <p className="text-sm text-slate-500">Gerencie os setores da empresa.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/setores", { format: "xlsx" }, "setores.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/setores", { format: "pdf" }, "setores.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {canEdit && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Novo setor
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Lista de setores"
          actions={<Input placeholder="Buscar por nome..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-56" />}
        />
        <DataTable
          columns={[
            { header: "Nome", cell: (d) => <span className="font-medium text-slate-700">{d.nome}</span> },
            { header: "Responsável", cell: (d) => d.responsavel || "-" },
            { header: "Colaboradores", cell: (d) => d._count?.employees ?? 0 },
            { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
            {
              header: "",
              cell: (d) =>
                canEdit && (
                  <div className="flex justify-end gap-1">
                    <Button title="Editar setor" variant="ghost" size="sm" onClick={() => openEdit(d)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button title="Ativar ou inativar setor" variant="ghost" size="sm" onClick={() => setToggling(d)}>
                      <Power className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              className: "text-right",
            },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(d) => d.id}
          emptyTitle="Nenhum setor cadastrado"
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar setor" : "Novo setor"}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>Salvar</Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && <InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner>}
          <Input label="Nome" required error={formState.errors.nome?.message} {...register("nome", { required: "Obrigatório." })} />
          <Input label="Responsável" {...register("responsavel")} />
          <Textarea label="Descrição" {...register("descricao")} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.status === "ATIVO" ? "Inativar setor" : "Reativar setor"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} o setor "${toggling?.nome}"?`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
