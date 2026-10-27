import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power, FileDown, FileSpreadsheet } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Position, Page } from "../../types";
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

type FormData = { nome: string; descricao?: string };

export default function PositionsPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["SEGURANCA_TRABALHO"]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [toggling, setToggling] = useState<Position | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Page<Position>>({
    queryKey: ["positions", page, search],
    queryFn: async () => (await api.get("/positions", { params: { page, search } })).data,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) =>
      editing ? api.put(`/positions/${editing.id}`, values) : api.post("/positions", values),
    onSuccess: () => {
      toast.success(editing ? "Cargo atualizado com sucesso." : "Cargo criado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (position: Position) =>
      api.patch(`/positions/${position.id}/status`, { status: position.status === "ATIVO" ? "INATIVO" : "ATIVO" }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      setToggling(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({ nome: "", descricao: "" });
    setModalOpen(true);
  }

  function openEdit(position: Position) {
    setEditing(position);
    reset({ nome: position.nome, descricao: position.descricao ?? "" });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Cargos</h1>
          <p className="text-sm text-slate-500">Gerencie os cargos da empresa e seus EPIs obrigatórios.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/cargos", { format: "xlsx" }, "cargos.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/cargos", { format: "pdf" }, "cargos.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {canEdit && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Novo cargo
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Lista de cargos"
          actions={
            <Input placeholder="Buscar por nome..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-56" />
          }
        />
        <DataTable
          columns={[
            { header: "Nome", cell: (p) => <span className="font-medium text-slate-700">{p.nome}</span> },
            { header: "Descrição", cell: (p) => p.descricao || "-" },
            { header: "Colaboradores", cell: (p) => p._count?.employees ?? 0 },
            { header: "EPIs na matriz", cell: (p) => p._count?.requirements ?? 0 },
            { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            {
              header: "",
              cell: (p) =>
                canEdit && (
                  <div className="flex justify-end gap-1">
                    <Button title="Editar cargo" variant="ghost" size="sm" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button title="Ativar ou inativar cargo" variant="ghost" size="sm" onClick={() => setToggling(p)}>
                      <Power className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              className: "text-right",
            },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(p) => p.id}
          emptyTitle="Nenhum cargo cadastrado"
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar cargo" : "Novo cargo"}
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
        title={toggling?.status === "ATIVO" ? "Inativar cargo" : "Reativar cargo"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} o cargo "${toggling?.nome}"?`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
