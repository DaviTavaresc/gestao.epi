import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
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

type FormData = { ppeItemId: string; quantidade: number; vidaUtilDiasOverride?: number };

export default function PositionMatrixPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["SEGURANCA_TRABALHO"]);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
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

  const addMutation = useMutation({
    mutationFn: async (values: FormData) =>
      api.post("/position-requirements", { ...values, positionId: selectedPositionId }),
    onSuccess: () => {
      toast.success("EPI vinculado ao cargo com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["position-requirements"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

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
            ) : (
              <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
                {positions?.items.map((p) => (
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
                <Button size="sm" onClick={() => { reset({ ppeItemId: "", quantidade: 1 }); setModalOpen(true); }}>
                  <Plus className="h-4 w-4" /> Adicionar EPI
                </Button>
              )
            }
          />
          <CardBody className="p-0">
            {!selectedPositionId ? (
              <EmptyState title="Selecione um cargo na lista ao lado" />
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
                      <Button title="Remover este EPI do cargo" variant="ghost" size="sm" onClick={() => setRemoving(req)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
        onClose={() => setModalOpen(false)}
        title="Adicionar EPI obrigatório"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={addMutation.isPending} onClick={handleSubmit((v) => addMutation.mutate(v))}>Adicionar</Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit((v) => addMutation.mutate(v))}>
          {addMutation.isError && <InlineBanner tone="error">{extractErrorMessage(addMutation.error)}</InlineBanner>}
          <Select label="EPI" required error={formState.errors.ppeItemId?.message} {...register("ppeItemId", { required: "Obrigatório." })}>
            <option value="">Selecione...</option>
            {ppeItems?.items.map((p) => <option key={p.id} value={p.id}>{p.nome} (vida útil padrão: {p.vidaUtilDias}d)</option>)}
          </Select>
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
