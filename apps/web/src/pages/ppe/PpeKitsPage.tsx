import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Power, Trash2 } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { PpeKit, PpeItem, Page } from "../../types";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input, Select, Textarea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StatusBadge } from "../../components/ui/Badge";
import { InlineBanner, EmptyState, Spinner } from "../../components/ui/Feedback";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";

type FormData = { nome: string; descricao?: string; items: { ppeItemId: string; quantidade: number }[] };

export default function PpeKitsPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["SEGURANCA_TRABALHO"]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PpeKit | null>(null);
  const [toggling, setToggling] = useState<PpeKit | null>(null);
  const queryClient = useQueryClient();

  const { data: kits, isLoading } = useQuery<PpeKit[]>({
    queryKey: ["ppe-kits"],
    queryFn: async () => (await api.get("/ppe-kits")).data,
  });
  const { data: ppeItems } = useQuery<Page<PpeItem>>({
    queryKey: ["ppe-items", "all"],
    queryFn: async () => (await api.get("/ppe-items", { params: { pageSize: 200, status: "ATIVO" } })).data,
  });

  const { register, control, handleSubmit, reset, formState } = useForm<FormData>({ defaultValues: { items: [{ ppeItemId: "", quantidade: 1 }] } });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) =>
      editing ? api.put(`/ppe-kits/${editing.id}`, values) : api.post("/ppe-kits", values),
    onSuccess: () => {
      toast.success(editing ? "Kit atualizado com sucesso." : "Kit criado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["ppe-kits"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (kit: PpeKit) => api.patch(`/ppe-kits/${kit.id}/status`, { status: kit.status === "ATIVO" ? "INATIVO" : "ATIVO" }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["ppe-kits"] });
      setToggling(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({ nome: "", descricao: "", items: [{ ppeItemId: "", quantidade: 1 }] });
    setModalOpen(true);
  }

  function openEdit(kit: PpeKit) {
    setEditing(kit);
    reset({ nome: kit.nome, descricao: kit.descricao ?? "", items: kit.items.map((i) => ({ ppeItemId: i.ppeItemId, quantidade: i.quantidade })) });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Kits de EPI</h1>
          <p className="text-sm text-slate-500">Agrupe EPIs frequentemente entregues juntos para agilizar a entrega.</p>
        </div>
        {canEdit && <Button onClick={openCreate}><Plus className="h-4 w-4" /> Novo kit</Button>}
      </div>

      {isLoading ? (
        <Spinner />
      ) : !kits?.length ? (
        <EmptyState title="Nenhum kit cadastrado" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kits.map((kit) => (
            <Card key={kit.id}>
              <CardHeader title={kit.nome} actions={<StatusBadge status={kit.status} />} />
              <CardBody>
                {kit.descricao && <p className="mb-2 text-sm text-slate-500">{kit.descricao}</p>}
                <ul className="mb-3 space-y-1 text-sm text-slate-600">
                  {kit.items.map((item) => (
                    <li key={item.id} className="flex justify-between">
                      <span>{item.ppeItem.nome}</span>
                      <span className="text-slate-400">x{item.quantidade}</span>
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(kit)}><Pencil className="h-4 w-4" /> Editar</Button>
                    <Button variant="ghost" size="sm" onClick={() => setToggling(kit)}><Power className="h-4 w-4" /></Button>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar kit" : "Novo kit"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>Salvar</Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && <InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner>}
          <Input label="Nome do kit" required error={formState.errors.nome?.message} {...register("nome", { required: "Obrigatório." })} />
          <Textarea label="Descrição" {...register("descricao")} />

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Itens do kit</p>
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-end gap-2">
                  <Select className="flex-1" {...register(`items.${index}.ppeItemId`, { required: true })}>
                    <option value="">Selecione o EPI...</option>
                    {ppeItems?.items.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </Select>
                  <Input className="w-24" type="number" min={1} {...register(`items.${index}.quantidade`, { required: true, valueAsNumber: true, min: 1 })} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)} disabled={fields.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => append({ ppeItemId: "", quantidade: 1 })}>
              <Plus className="h-4 w-4" /> Adicionar item
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.status === "ATIVO" ? "Inativar kit" : "Reativar kit"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} o kit "${toggling?.nome}"?`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
