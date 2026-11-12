import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power, Building2, Store, FileDown, FileSpreadsheet, Trash2 } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Branch } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StatusBadge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { usePermissions } from "../../hooks/usePermissions";
import { agruparPorEmpresa } from "../../hooks/useBranches";
import { toast } from "../../stores/toastStore";

type FormData = {
  nome: string;
  // Vazio = este registro e a empresa (o CNPJ). Preenchido = e uma filial dela.
  parentId?: string;
  codigo?: string;
  cnpj?: string;
  uf?: string;
  cidade?: string;
  endereco?: string;
  responsavel?: string;
};

export default function BranchesPage() {
  const { isAdminOrRh } = usePermissions();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [toggling, setToggling] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Branch[]>({
    queryKey: ["branches", "all-status"],
    queryFn: async () => (await api.get("/branches")).data,
  });

  const { register, handleSubmit, reset, formState, watch } = useForm<FormData>();
  const parentIdSelecionado = watch("parentId");

  // Lista em dois niveis: cada empresa seguida das filiais dela. A API devolve
  // tudo em ordem alfabetica, o que embaralharia loja e CNPJ na mesma lista.
  const grupos = agruparPorEmpresa(data);
  const linhas = grupos.flatMap(({ empresa, filiais }) => [empresa, ...filiais]);

  // So empresas podem receber filiais — a arvore tem dois andares. Na edicao, o
  // proprio registro sai da lista: ninguem e filial de si mesmo.
  const empresas = (data ?? []).filter((b) => !b.parentId && b.id !== editing?.id);

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) =>
      editing ? api.put(`/branches/${editing.id}`, values) : api.post("/branches", values),
    onSuccess: () => {
      toast.success(editing ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso.");
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

  // A API recusa a exclusão de quem já tem vínculo e manda inativar. A mensagem
  // dela é mostrada como está, sem reescrever: é ela que diz o que trava.
  const deleteMutation = useMutation({
    mutationFn: async () => api.delete(`/branches/${deleting!.id}`),
    onSuccess: () => {
      toast.success("Cadastro excluído.");
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({ nome: "", parentId: "", codigo: "", cnpj: "", uf: "", cidade: "", endereco: "", responsavel: "" });
    setModalOpen(true);
  }

  function openEdit(branch: Branch) {
    setEditing(branch);
    reset({
      nome: branch.nome,
      parentId: branch.parentId ?? "",
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
          <h1 className="text-xl font-semibold text-slate-800">Empresas e filiais</h1>
          <p className="text-sm text-slate-500">
            A empresa é a razão social com CNPJ próprio. A filial é a unidade física dela — e é na filial
            que ficam o estoque, os colaboradores e as entregas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/estoque", { format: "xlsx" }, "estoque-por-filial.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Estoque (Excel)
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/estoque", { format: "pdf" }, "estoque-por-filial.pdf")}>
            <FileDown className="h-4 w-4" /> Estoque (PDF)
          </Button>
          {isAdminOrRh && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Nova empresa ou filial
            </Button>
          )}
        </div>
      </div>

      {!isAdminOrRh && (
        <InlineBanner tone="info">
          Apenas os perfis Administrador e RH podem cadastrar, editar, inativar ou excluir empresas e filiais.
        </InlineBanner>
      )}

      <Card>
        <CardHeader title="Empresas e filiais" />
        <DataTable
          columns={[
            {
              header: "Empresa / Filial",
              cell: (b) =>
                b.parentId ? (
                  <span className="flex items-center gap-2 pl-5 text-slate-600">
                    <Store className="h-4 w-4 text-slate-400" />
                    {b.nome}
                    {b.codigo && <span className="text-xs text-slate-400">({b.codigo})</span>}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 font-semibold text-navy-700">
                    <Building2 className="h-4 w-4 text-slate-400" />
                    {b.nome}
                    {b.codigo && <span className="text-xs text-slate-400">({b.codigo})</span>}
                  </span>
                ),
            },
            {
              header: "Tipo",
              cell: (b) =>
                b.parentId ? (
                  <span className="text-xs text-slate-500">Filial de {b.parent?.nome ?? "-"}</span>
                ) : (
                  <span className="text-xs text-slate-500">
                    Empresa{b.cnpj ? ` — CNPJ ${b.cnpj}` : " — sem CNPJ cadastrado"}
                    {b._count?.filiais ? ` · ${b._count.filiais} filial(is)` : ""}
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
                isAdminOrRh && (
                  <div className="flex justify-end gap-1">
                    <Button title="Editar cadastro" variant="ghost" size="sm" onClick={() => openEdit(b)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button title="Ativar ou inativar" variant="ghost" size="sm" onClick={() => setToggling(b)}>
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button title="Excluir cadastro" variant="ghost" size="sm" onClick={() => setDeleting(b)}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                ),
              className: "text-right",
            },
          ]}
          rows={linhas}
          loading={isLoading}
          rowKey={(b) => b.id}
          emptyTitle="Nenhuma empresa cadastrada"
          emptyDescription="Cadastre primeiro a empresa (a razão social com CNPJ) e depois as filiais dela."
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar empresa ou filial" : "Nova empresa ou filial"}
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
            <Select
              label="Empresa"
              hint="Deixe em branco quando este cadastro for a própria empresa — a razão social com CNPJ. Escolha uma empresa quando for uma filial física dela (loja, unidade)."
              {...register("parentId")}
            >
              <option value="">Este cadastro é uma empresa (tem CNPJ próprio)</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                  {e.cnpj ? ` — CNPJ ${e.cnpj}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Input
              label={parentIdSelecionado ? "Nome da filial" : "Razão social da empresa"}
              required
              hint={
                parentIdSelecionado
                  ? 'O nome não se repete no sistema inteiro: inclua a cidade quando houver risco de confusão — ex.: "Centro (Porto Velho)"'
                  : 'Ex.: "PARA PNEU FORTE LTDA"'
              }
              error={formState.errors.nome?.message}
              {...register("nome", { required: "Obrigatório." })}
            />
          </div>
          <Input label="Código" hint="Sigla interna, ex.: PA" {...register("codigo")} />
          <Input
            label="CNPJ"
            hint={parentIdSelecionado ? "Só preencha se esta filial tiver CNPJ próprio." : undefined}
            {...register("cnpj")}
          />
          <Input label="Cidade" {...register("cidade")} />
          <Input label="UF" maxLength={2} {...register("uf")} />
          <Input label="Endereço" {...register("endereco")} />
          <Input label="Responsável" {...register("responsavel")} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.status === "ATIVO" ? "Inativar cadastro" : "Reativar cadastro"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} "${toggling?.nome}"?${
          toggling && !toggling.parentId && toggling._count?.filiais
            ? " Uma empresa só pode ser inativada depois que as filiais dela forem inativadas."
            : ""
        }`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={deleting?.parentId ? "Excluir filial" : "Excluir empresa"}
        message={`Excluir "${deleting?.nome}"? Isso apaga o cadastro de vez e não tem volta. Se houver colaborador, acesso, entrega, estoque, compra, cobrança — ou, no caso de uma empresa, filiais vinculadas —, a exclusão será recusada: nesse caso use Inativar, que tira o cadastro do uso e preserva o histórico.`}
        confirmLabel="Excluir"
        tone="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
