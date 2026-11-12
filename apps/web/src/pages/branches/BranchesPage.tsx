import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power, Building2, Store, FileDown, FileSpreadsheet, Trash2 } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Branch, ImpactoDaExclusao } from "../../types";
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
  const [confirmacao, setConfirmacao] = useState("");
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

  // Prévia do estrago, buscada só quando o diálogo abre. É ela que transforma
  // "excluir a empresa" em "apagar a entrega de 69 pessoas".
  const { data: impacto, isLoading: carregandoImpacto } = useQuery<ImpactoDaExclusao>({
    queryKey: ["branch-impacto", deleting?.id],
    queryFn: async () => (await api.get(`/branches/${deleting!.id}/impacto`)).data,
    enabled: !!deleting,
  });

  // A confirmação digitada viaja no corpo do DELETE: a API recusa se não bater
  // com o nome exato. A trava é dela, não da tela — o botão aqui é só o gatilho.
  const deleteMutation = useMutation({
    mutationFn: async () => api.delete(`/branches/${deleting!.id}`, { data: { confirmacao } }),
    onSuccess: () => {
      toast.success(`"${deleting?.nome}" foi excluído junto com tudo que dependia dele.`);
      queryClient.invalidateQueries();
      setDeleting(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function abrirExclusao(branch: Branch) {
    setConfirmacao("");
    setDeleting(branch);
  }

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
                    <Button title="Excluir cadastro" variant="ghost" size="sm" onClick={() => abrirExclusao(b)}>
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

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting?.parentId ? "Excluir filial" : "Excluir empresa"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={confirmacao.trim() !== deleting?.nome}
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Excluir definitivamente
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <InlineBanner tone="error">
            Isto apaga o cadastro e <strong>todo o histórico ligado a ele</strong>, inclusive os termos de
            entrega assinados. Não tem volta e não há backup dentro do sistema. Para só tirar de uso sem
            perder nada, feche aqui e use <strong>Inativar</strong>.
          </InlineBanner>

          {carregandoImpacto && <p className="text-sm text-slate-500">Levantando o que será apagado...</p>}

          {impacto && (
            <div className="space-y-3">
              {impacto.filiais.length > 0 && (
                <p className="text-sm text-slate-700">
                  Sai junto {impacto.filiais.length === 1 ? "a filial" : "as filiais"}:{" "}
                  <strong>{impacto.filiais.map((f) => f.nome).join(", ")}</strong>.
                </p>
              )}

              <div className="rounded-lg border border-slate-200">
                <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                  Será apagado
                </p>
                <ul className="divide-y divide-slate-100 text-sm">
                  {[
                    ["Colaboradores lotados aqui", impacto.totais.colaboradores],
                    ["Entregas (com os termos assinados)", impacto.totais.entregas],
                    ["Devoluções", impacto.totais.devolucoes],
                    ["Cobranças", impacto.totais.cobrancas],
                    ["Movimentações de estoque", impacto.totais.movimentacoes],
                    ["EPIs em estoque", impacto.totais.itensEmEstoque],
                    ["Compras", impacto.totais.compras],
                    ["Arquivos anexados (fichas e fotos)", impacto.totais.documentos],
                  ]
                    .filter(([, n]) => (n as number) > 0)
                    .map(([rotulo, n]) => (
                      <li key={rotulo as string} className="flex justify-between px-3 py-1.5">
                        <span className="text-slate-600">{rotulo}</span>
                        <strong className="text-red-700">{n as number}</strong>
                      </li>
                    ))}
                  {Object.values(impacto.totais).every((n) => n === 0) && (
                    <li className="px-3 py-2 text-slate-500">Nada vinculado — este cadastro está vazio.</li>
                  )}
                </ul>
              </div>

              {(impacto.totais.usuariosDesvinculados > 0 || impacto.totais.contratosDesvinculados > 0) && (
                <div className="rounded-lg border border-slate-200">
                  <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                    Não será apagado, só desvinculado
                  </p>
                  <ul className="divide-y divide-slate-100 text-sm">
                    {impacto.totais.usuariosDesvinculados > 0 && (
                      <li className="px-3 py-1.5 text-slate-600">
                        <strong>{impacto.totais.usuariosDesvinculados}</strong> acesso(s) de usuário — a conta
                        continua existindo, perde a filial e fica <strong>inativa</strong>.
                      </li>
                    )}
                    {impacto.totais.contratosDesvinculados > 0 && (
                      <li className="px-3 py-1.5 text-slate-600">
                        <strong>{impacto.totais.contratosDesvinculados}</strong> colaborador(es) de outra filial que
                        tinham contrato com esta empresa — o cadastro fica, só perde o vínculo de contrato.
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {deleteMutation.isError && <InlineBanner tone="error">{extractErrorMessage(deleteMutation.error)}</InlineBanner>}

          <Input
            label={`Para confirmar, digite o nome exato: ${deleting?.nome ?? ""}`}
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            placeholder={deleting?.nome ?? ""}
            autoComplete="off"
          />
        </div>
      </Modal>
    </div>
  );
}
