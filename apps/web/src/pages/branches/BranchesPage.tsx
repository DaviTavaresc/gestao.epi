import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power, Building2, FileDown, FileSpreadsheet } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Branch } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StatusBadge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";

type FormData = {
  nome: string;
  codigo?: string;
  cnpj?: string;
  uf?: string;
  cidade?: string;
  endereco?: string;
  responsavel?: string;
};

export default function BranchesPage() {
  const { isAdmin } = usePermissions();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [toggling, setToggling] = useState<Branch | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Branch[]>({
    queryKey: ["branches", "all-status"],
    queryFn: async () => (await api.get("/branches")).data,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) =>
      editing ? api.put(`/branches/${editing.id}`, values) : api.post("/branches", values),
    onSuccess: () => {
      toast.success(editing ? "Filial atualizada com sucesso." : "Filial criada com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (branch: Branch) =>
      api.patch(`/branches/${branch.id}/status`, { status: branch.status === "ATIVO" ? "INATIVO" : "ATIVO" }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      setToggling(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({ nome: "", codigo: "", cnpj: "", uf: "", cidade: "", endereco: "", responsavel: "" });
    setModalOpen(true);
  }

  function openEdit(branch: Branch) {
    setEditing(branch);
    reset({
      nome: branch.nome,
      codigo: branch.codigo ?? "",
      cnpj: branch.cnpj ?? "",
      uf: branch.uf ?? "",
      cidade: branch.cidade ?? "",
      endereco: branch.endereco ?? "",
      responsavel: branch.responsavel ?? "",
    });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Filiais</h1>
          <p className="text-sm text-slate-500">
            Cada filial tem seu próprio estoque, colaboradores e entregas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/estoque", { format: "xlsx" }, "estoque-por-filial.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Estoque (Excel)
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/estoque", { format: "pdf" }, "estoque-por-filial.pdf")}>
            <FileDown className="h-4 w-4" /> Estoque (PDF)
          </Button>
          {isAdmin && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Nova filial
            </Button>
          )}
        </div>
      </div>

      {!isAdmin && (
        <InlineBanner tone="info">
          Apenas usuários com perfil Administrador podem cadastrar, editar ou inativar filiais.
        </InlineBanner>
      )}

      <Card>
        <CardHeader title="Lista de filiais" />
        <DataTable
          columns={[
            {
              header: "Filial",
              cell: (b) => (
                <span className="flex items-center gap-2 font-medium text-slate-700">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  {b.nome}
                  {b.codigo && <span className="text-xs text-slate-400">({b.codigo})</span>}
                </span>
              ),
            },
            { header: "Cidade/UF", cell: (b) => [b.cidade, b.uf].filter(Boolean).join(" / ") || "-" },
            { header: "Responsável", cell: (b) => b.responsavel || "-" },
            { header: "Colaboradores", cell: (b) => b._count?.employees ?? 0 },
            { header: "Itens em estoque", cell: (b) => b._count?.stocks ?? 0 },
            { header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
            {
              header: "",
              cell: (b) =>
                isAdmin && (
                  <div className="flex justify-end gap-1">
                    <Button title="Editar filial" variant="ghost" size="sm" onClick={() => openEdit(b)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button title="Ativar ou inativar filial" variant="ghost" size="sm" onClick={() => setToggling(b)}>
                      <Power className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              className: "text-right",
            },
          ]}
          rows={data ?? []}
          loading={isLoading}
          rowKey={(b) => b.id}
          emptyTitle="Nenhuma filial cadastrada"
          emptyDescription="Cadastre as unidades da empresa para separar colaboradores e estoque."
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar filial" : "Nova filial"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>
              Salvar
            </Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && (
            <div className="sm:col-span-2">
              <InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner>
            </div>
          )}
          <div className="sm:col-span-2">
            <Input
              label="Nome da filial"
              required
              hint='Ex.: "Filial Pará", "Filial Amazonas"'
              error={formState.errors.nome?.message}
              {...register("nome", { required: "Obrigatório." })}
            />
          </div>
          <Input label="Código" hint="Sigla interna, ex.: PA" {...register("codigo")} />
          <Input label="CNPJ" {...register("cnpj")} />
          <Input label="Cidade" {...register("cidade")} />
          <Input label="UF" maxLength={2} {...register("uf")} />
          <Input label="Endereço" {...register("endereco")} />
          <Input label="Responsável" {...register("responsavel")} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.status === "ATIVO" ? "Inativar filial" : "Reativar filial"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} a filial "${toggling?.nome}"?`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
