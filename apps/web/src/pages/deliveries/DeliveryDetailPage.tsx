import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileDown, Ban } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { Delivery } from "../../types";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/Field";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner, EmptyState, InlineBanner } from "../../components/ui/Feedback";
import { Modal } from "../../components/ui/Modal";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";
import { CameraCapture } from "../../components/CameraCapture";
import { AuthenticatedImage } from "../../components/AuthenticatedImage";
import { openPdfFromApi } from "../../lib/download";
import { Organization } from "../../types";

export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canWrite, isAdmin } = usePermissions();
  const canEdit = canWrite(["ALMOXARIFADO", "SEGURANCA_TRABALHO"]);

  const [nomeDigitado, setNomeDigitado] = useState("");
  const [concordo, setConcordo] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [abrindoTermo, setAbrindoTermo] = useState(false);

  const { data: delivery, isLoading } = useQuery<Delivery>({
    queryKey: ["delivery", id],
    queryFn: async () => (await api.get(`/deliveries/${id}`)).data,
  });

  const { data: organization } = useQuery<Organization>({
    queryKey: ["organization"],
    queryFn: async () => (await api.get("/organization")).data,
  });
  const fotoObrigatoria = organization?.exigirFotoConfirmacao ?? false;

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("nomeDigitado", nomeDigitado);
      formData.append("concordo", "true");
      if (photo) formData.append("photo", photo);
      return api.post(`/deliveries/${id}/confirm`, formData);
    },
    onSuccess: () => {
      toast.success("Entrega confirmada eletronicamente com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["delivery", id] });
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => api.post(`/deliveries/${id}/cancel`, motivoCancelamento ? { motivo: motivoCancelamento } : {}),
    onSuccess: () => {
      toast.success("Entrega cancelada e estoque restituído.");
      queryClient.invalidateQueries({ queryKey: ["delivery", id] });
      setConfirmCancel(false);
      setMotivoCancelamento("");
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const nameMatches = useMemo(() => {
    if (!delivery) return false;
    const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
    return normalize(nomeDigitado) === normalize(delivery.employee.nomeCompleto);
  }, [nomeDigitado, delivery]);

  if (isLoading) return <Spinner />;
  if (!delivery) return <EmptyState title="Entrega não encontrada" />;

  return (
    <div className="space-y-6">
      <button onClick={() => navigate("/entregas")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Voltar para entregas
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">
            Entrega para{" "}
            <Link to={`/colaboradores/${delivery.employeeId}`} className="text-navy-700 hover:underline">
              {delivery.employee.nomeCompleto}
            </Link>
          </h1>
          <p className="text-sm text-slate-500">
            {new Date(delivery.createdAt).toLocaleDateString("pt-BR")} às{" "}
            {new Date(delivery.createdAt).toLocaleTimeString("pt-BR")} · Motivo: {delivery.motivo} · Por{" "}
            {delivery.createdBy.name}
            {delivery.branch && <> · {delivery.branch.nome}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={delivery.status} />
          <Button
            variant="outline"
            loading={abrindoTermo}
            onClick={async () => {
              setAbrindoTermo(true);
              try {
                await openPdfFromApi(`/deliveries/${delivery.id}/termo.pdf`, `termo-entrega-${delivery.id}.pdf`);
              } catch (err) {
                toast.error(extractErrorMessage(err));
              } finally {
                setAbrindoTermo(false);
              }
            }}
          >
            <FileDown className="h-4 w-4" /> Termo de entrega (PDF)
          </Button>
          {canEdit && delivery.status === "PENDENTE" && (
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>
              <Ban className="h-4 w-4" /> Cancelar
            </Button>
          )}
          {isAdmin && delivery.status === "CONFIRMADA" && (
            <Button variant="danger" onClick={() => { setMotivoCancelamento(""); setConfirmCancel(true); }}>
              <Ban className="h-4 w-4" /> Cancelar entrega
            </Button>
          )}
        </div>
      </div>

      {delivery.status === "CANCELADA" && (
        <InlineBanner tone="error">
          <strong>Entrega cancelada</strong>
          {delivery.canceladoEm && <> em {new Date(delivery.canceladoEm).toLocaleString("pt-BR")}</>}
          {delivery.canceladoPor && <> por {delivery.canceladoPor.name}</>}.
          {delivery.cancelamentoMotivo && <> Justificativa: {delivery.cancelamentoMotivo}</>}
          <span className="mt-1 block text-xs">
            Os itens voltaram ao estoque da filial e esta entrega não conta mais como EPI ativo do colaborador.
          </span>
        </InlineBanner>
      )}

      <Card>
        <CardHeader title="Itens entregues" />
        <CardBody className="p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <th className="px-5 py-3">EPI</th>
                <th className="px-5 py-3">CA</th>
                <th className="px-5 py-3">Qtd</th>
                <th className="px-5 py-3">Troca prevista</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {delivery.items.map((item) => (
                <tr key={item.id} className="border-b border-slate-50">
                  <td className="px-5 py-3">{item.ppeItem.nome}</td>
                  <td className="px-5 py-3">{item.caSnapshot}</td>
                  <td className="px-5 py-3">{item.quantidade}</td>
                  <td className="px-5 py-3">{new Date(item.dataPrevistaTroca).toLocaleDateString("pt-BR")}</td>
                  <td className="px-5 py-3"><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Confirmação eletrônica de recebimento" />
        <CardBody className="space-y-4">
          {delivery.confirmation ? (
            <div className="space-y-4">
              <InlineBanner tone="success">
                Confirmado por "{delivery.confirmation.nomeDigitado.trim()}" em{" "}
                {new Date(delivery.confirmation.confirmedAt).toLocaleDateString("pt-BR")} às{" "}
                {new Date(delivery.confirmation.confirmedAt).toLocaleTimeString("pt-BR")}.
              </InlineBanner>
              {delivery.confirmation.photoPath && (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">Foto do recebimento</p>
                  <AuthenticatedImage
                    url={`/deliveries/${delivery.id}/confirmation-photo`}
                    alt="Foto do colaborador no recebimento"
                    className="max-h-72 rounded-lg border border-slate-200"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Capturada pela câmera no momento da confirmação · ID {delivery.confirmation.id}
                  </p>
                </div>
              )}
            </div>
          ) : delivery.status === "PENDENTE" ? (
            <>
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                Declaro que recebi os EPIs relacionados nesta entrega e estou ciente da responsabilidade pela utilização,
                conservação e comunicação de qualquer necessidade de substituição.
              </p>
              <Input
                label="Digite seu nome completo para confirmar"
                value={nomeDigitado}
                onChange={(e) => setNomeDigitado(e.target.value)}
                error={nomeDigitado && !nameMatches ? "O nome digitado não corresponde ao nome cadastrado." : undefined}
              />
              <CameraCapture
                onCapture={setPhoto}
                required={fotoObrigatoria}
                label={fotoObrigatoria ? "Foto do colaborador recebendo os EPIs" : "Foto do recebimento (opcional)"}
              />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} className="h-4 w-4" />
                Confirmo que li e concordo com a declaração acima.
              </label>
              <Button
                disabled={!nameMatches || !concordo || (fotoObrigatoria && !photo)}
                loading={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
              >
                Confirmar entrega
              </Button>
            </>
          ) : (
            <InlineBanner tone="warning">Esta entrega não está mais pendente de confirmação.</InlineBanner>
          )}
        </CardBody>
      </Card>

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={delivery.status === "CONFIRMADA" ? "Cancelar entrega confirmada" : "Cancelar entrega"}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              loading={cancelMutation.isPending}
              disabled={delivery.status === "CONFIRMADA" && motivoCancelamento.trim().length < 5}
              onClick={() => cancelMutation.mutate()}
            >
              Cancelar entrega
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {delivery.status === "CONFIRMADA" ? (
            <>
              <InlineBanner tone="warning">
                Esta entrega já foi confirmada pelo colaborador. O cancelamento é um <strong>estorno</strong>: os itens
                voltam ao estoque e a entrega deixa de valer, mas a confirmação original fica guardada como evidência e
                a ação é registrada na auditoria.
              </InlineBanner>
              <Textarea
                label="Justificativa do cancelamento"
                required
                hint="Mínimo de 5 caracteres. Ficará registrada na auditoria e no termo."
                value={motivoCancelamento}
                onChange={(e) => setMotivoCancelamento(e.target.value)}
              />
            </>
          ) : (
            <p className="text-sm text-slate-600">
              O estoque dos itens desta entrega será restituído à filial. Esta ação não pode ser desfeita.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
