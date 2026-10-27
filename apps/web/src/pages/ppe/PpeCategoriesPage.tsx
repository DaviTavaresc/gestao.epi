import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { PpeCategory } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StatusBadge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";

type FormData = { nome: string; descricao?: string };

export default function PpeCategoriesPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["SEGURANCA_TRABALHO"]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PpeCategory | null>(null);
  const [toggling, setToggling] = useState<PpeCategory | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<PpeCategory[]>({
    queryKey: ["ppe-categories"],
    queryFn: async () => (await api.get("/ppe-categories")).data,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) =>
      editing ? api.put(`/ppe-categories/${editing.id}`, values) : api.post("/ppe-categories", values),
    onSuccess: () => {
      toast.success(editing ? "Categoria atualizada com sucesso." : "Categoria criada com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["ppe-categories"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (category: PpeCategory) =>
      api.patch(`/ppe-categories/${category.id}/status`, { status: category.status === "ATIVO" ? "INATIVO" : "ATIVO" }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["ppe-categories"] });
      setToggling(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({ nome: "", descricao: "" });
    setModalOpen(true);
  }

  function openEdit(category: PpeCategory) {
    setEditing(category);
    reset({ nome: category.nome, descricao: category.descricao ?? "" });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Categorias de EPI</h1>
          <p className="text-sm text-slate-500">Organize os EPIs por tipo de proteção.</p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nova categoria
          </Button>
        )}
      </div>

      <Card>
        <CardHeader title="Lista de categorias" />
        <DataTable
          columns={[
            { header: "Nome", cell: (c) => <span className="font-medium text-slate-700">{c.nome}</span> },
            { header: "Descrição", cell: (c) => c.descricao || "-" },
            { header: "EPIs", cell: (c) => c._count?.items ?? 0 },
            { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
            {
              header: "",
              cell: (c) =>
                canEdit && (
                  <div className="flex justify-end gap-1">
                    <Button title="Editar categoria" variant="ghost" size="sm" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button title="Ativar ou inativar categoria" variant="ghost" size="sm" onClick={() => setToggling(c)}><Power className="h-4 w-4" /></Button>
                  </div>
                ),
              className: "text-right",
            },
          ]}
          rows={data ?? []}
          loading={isLoading}
          rowKey={(c) => c.id}
          emptyTitle="Nenhuma categoria cadastrada"
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar categoria" : "Nova categoria"}
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
          <Textarea label="Descrição" {...register("descricao")} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.status === "ATIVO" ? "Inativar categoria" : "Reativar categoria"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} a categoria "${toggling?.nome}"?`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
