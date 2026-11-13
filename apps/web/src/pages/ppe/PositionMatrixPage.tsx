import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { api, extractErrorMessage } from "../../lib/api";
import { Position, PpeItem, Page, PositionRequirement } from "../../types";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Select, Input } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState, Spinner, InlineBanner } from "../../components/ui/Feedback";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";

type FormData = { ppeItemId: string; quantidade: number; vidaUtilDiasOverride?: number | null };

export default function PositionMatrixPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["RH", "GERENTE"]);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Preenchido = o modal esta editando um vinculo que ja existe; nulo = esta criando.
  const [editando, setEditando] = useState<PositionRequirement | null>(null);
  const [removing, setRemoving] = useState<PositionRequirement | null>(null);
  const queryClient = useQueryClient();

  const { data: positions, isLoading: loadingPositions } = useQuery<Page<Position>>({
    queryKey: ["positions", "matrix"],
    queryFn: async () => (await api.get("/positions", { params: { pageSize: 100, status: "ATIVO" } })).data,
  });
  const { data: ppeItems } = useQuery<Page<PpeItem>>({
    queryKey: ["ppe-items", "all"],
    queryFn: async () => (await api.get("/ppe-items", { params: { pageSize: 200, status: "ATIVO" } })).data,
  });
  const { data: requirements, isLoading: loadingRequirements } = useQuery<PositionRequirement[]>({
    queryKey: ["position-requirements", selectedPositionId],
    queryFn: async () => (await api.get("/position-requirements", { params: { positionId: selectedPositionId } })).data,
    enabled: !!selectedPositionId,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  const salvarMutation = useMutation({
    mutationFn: async (values: FormData) => {
      // Campo em branco chega como NaN do react-hook-form. Mandar null e o que
      // devolve o EPI para a vida util padrao dele; mandar NaN nao limparia nada.
      const vidaUtil = Number.isFinite(values.vidaUtilDiasOverride as number)
        ? (values.vidaUtilDiasOverride as number)
        : null;
      // Na edicao o EPI nao muda: trocar o EPI de um vinculo e, na pratica, outro
      // vinculo. Quem quer outro EPI adiciona uma linha nova.
      if (editando) {
        return api.put(`/position-requirements/${editando.id}`, {
          quantidade: values.quantidade,
          vidaUtilDiasOverride: vidaUtil,
        });
      }
      return api.post("/position-requirements", {
        positionId: selectedPositionId,
        ppeItemId: values.ppeItemId,
        quantidade: values.quantidade,
        vidaUtilDiasOverride: vidaUtil,
      });
    },
    onSuccess: () => {
      toast.success(editando ? "Vínculo atualizado com sucesso." : "EPI vinculado ao cargo com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["position-requirements"] });
      setModalOpen(false);
      setEditando(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function abrirCriacao() {
    setEditando(null);
    reset({ ppeItemId: "", quantidade: 1, vidaUtilDiasOverride: undefined });
    setModalOpen(true);
  }

  function abrirEdicao(req: PositionRequirement) {
    setEditando(req);
    reset({
      ppeItemId: req.ppeItemId,
      quantidade: req.quantidade,
      vidaUtilDiasOverride: req.vidaUtilDiasOverride ?? undefined,
    });
    setModalOpen(true);
  }

  function fecharModal() {
    setModalOpen(false);
    setEditando(null);
  }

  const removeMutation = useMutation({
    mutationFn: async (requirement: PositionRequirement) => api.delete(`/position-requirements/${requirement.id}`),
    onSuccess: () => {
      toast.success("Vínculo removido com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["position-requirements"] });
      setRemoving(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const selectedPosition = positions?.items.find((p) => p.id === selectedPositionId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Matriz Cargo x EPI</h1>
        <p className="text-sm text-slate-500">Defina quais EPIs são obrigatórios para cada cargo e em qual quantidade.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader title="Cargos" />
          <CardBody className="p-0">
            {loadingPositions ? (
              <Spinner />
            ) : !positions?.items.length ? (
              // Sem cargo nenhum a tela ficava em branco e parecia bloqueada: o
              // botao de adicionar EPI so existe depois de escolher um cargo.
              <EmptyState
                title="Nenhum cargo ativo cadastrado"
                description="A matriz parte do cargo. Cadastre os cargos primeiro e eles aparecem aqui."
                action={
                  canEdit ? (
                    <Link to="/cargos">
                      <Button size="sm" variant="outline">Ir para Cargos</Button>
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
                {positions.items.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelectedPositionId(p.id)}
                      className={clsx(
                        "block w-full px-5 py-3 text-left text-sm",
                        selectedPositionId === p.id ? "bg-navy-50 font-medium text-navy-700" : "text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      {p.nome}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={selectedPosition ? `EPIs obrigatórios — ${selectedPosition.nome}` : "Selecione um cargo"}
            actions={
              canEdit &&
              selectedPositionId && (
                <Button size="sm" onClick={abrirCriacao}>
                  <Plus className="h-4 w-4" /> Adicionar EPI
                </Button>
              )
            }
          />
          <CardBody className="p-0">
            {!selectedPositionId ? (
              <EmptyState
                title="Selecione um cargo na lista ao lado"
                description={
                  canEdit
                    ? "Depois de escolher o cargo aparece o botão para adicionar os EPIs obrigatórios dele."
                    : "Seu perfil acompanha a matriz, mas não altera o que está definido."
                }
              />
            ) : loadingRequirements ? (
              <Spinner />
            ) : !requirements?.length ? (
              <EmptyState title="Nenhum EPI obrigatório configurado para este cargo" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {requirements.map((req) => (
                  <li key={req.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-700">{req.ppeItem.nome}</p>
                      <p className="text-slate-400">
                        Quantidade: {req.quantidade} · Vida útil: {req.vidaUtilDiasOverride ?? req.ppeItem.vidaUtilDias} dias
                        {req.vidaUtilDiasOverride ? " (customizada)" : ""}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          title="Alterar a quantidade ou a vida útil deste EPI no cargo"
                          variant="outline"
                          size="sm"
                          onClick={() => abrirEdicao(req)}
                        >
                          <Pencil className="h-4 w-4" /> Editar
                        </Button>
                        <Button title="Remover este EPI do cargo" variant="ghost" size="sm" onClick={() => setRemoving(req)}>
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={modalOpen}
        onClose={fecharModal}
        title={editando ? `Editar — ${editando.ppeItem.nome}` : "Adicionar EPI obrigatório"}
        footer={
          <>
            <Button variant="outline" onClick={fecharModal}>Cancelar</Button>
            <Button loading={salvarMutation.isPending} onClick={handleSubmit((v) => salvarMutation.mutate(v))}>
              {editando ? "Salvar" : "Adicionar"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit((v) => salvarMutation.mutate(v))}>
          {salvarMutation.isError && <InlineBanner tone="error">{extractErrorMessage(salvarMutation.error)}</InlineBanner>}
          {editando ? (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
              <p className="font-medium text-slate-700">{editando.ppeItem.nome}</p>
              <p className="text-slate-500">
                Vida útil padrão do EPI: {editando.ppeItem.vidaUtilDias} dias. Para trocar o EPI, remova esta linha e
                adicione outra.
              </p>
            </div>
          ) : (
            <Select label="EPI" required error={formState.errors.ppeItemId?.message} {...register("ppeItemId", { required: "Obrigatório." })}>
              <option value="">Selecione...</option>
              {ppeItems?.items.map((p) => <option key={p.id} value={p.id}>{p.nome} (vida útil padrão: {p.vidaUtilDias}d)</option>)}
            </Select>
          )}
          <Input label="Quantidade" type="number" min={1} required {...register("quantidade", { required: true, valueAsNumber: true, min: 1 })} />
          <Input label="Vida útil customizada (dias)" type="number" min={1} hint="Deixe em branco para usar a vida útil padrão do EPI" {...register("vidaUtilDiasOverride", { valueAsNumber: true, min: 1 })} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        title="Remover vínculo"
        message={`Remover "${removing?.ppeItem.nome}" dos EPIs obrigatórios deste cargo?`}
        tone="danger"
        loading={removeMutation.isPending}
        onConfirm={() => removing && removeMutation.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
