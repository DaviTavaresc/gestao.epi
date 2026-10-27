import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, AlertTriangle, FileDown } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { PpeItem, PpeKit, BranchStock } from "../../types";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Select, Input } from "../../components/ui/Field";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner, InlineBanner, EmptyState } from "../../components/ui/Feedback";
import { toast } from "../../stores/toastStore";
import { EmployeePickerModal } from "./EmployeePickerModal";
import { CameraCapture } from "../../components/CameraCapture";
import { openPdfFromApi } from "../../lib/download";
import { Organization } from "../../types";

type SuggestedItem = {
  requirementId: string;
  ppeItem: PpeItem;
  quantidadeExigida: number;
  vidaUtilDias: number;
  status: string;
  caStatus: string;
  estoqueDisponivel: number;
  estoqueSuficiente: boolean;
  podeEntregar: boolean;
  ultimaEntrega: { dataEntrega: string; dataPrevistaTroca: string } | null;
};

type PrepareResponse = {
  employee: {
    id: string;
    nomeCompleto: string;
    status: string;
    position: { nome: string } | null;
    branch: { id: string; nome: string } | null;
  };
  itensSugeridos: SuggestedItem[];
};

// Explica por que o item sugerido não pode ser marcado. "informativo" distingue o caso
// normal (o colaborador já tem o EPI em uso) dos bloqueios que exigem ação.
function motivoBloqueio(item: SuggestedItem): { texto: string; informativo: boolean } {
  if (item.caStatus === "VENCIDO") return { texto: "CA vencido — entrega bloqueada", informativo: false };
  if (item.ppeItem.status !== "ATIVO") return { texto: "EPI inativo no catálogo", informativo: false };
  if (item.status === "REGULAR") {
    const troca = item.ultimaEntrega
      ? ` — troca prevista para ${new Date(item.ultimaEntrega.dataPrevistaTroca).toLocaleDateString("pt-BR")}`
      : "";
    return {
      texto: `Já em uso e dentro da vida útil${troca}. Para entregar antes da hora, use "Adicionar outro EPI".`,
      informativo: true,
    };
  }
  if (!item.estoqueSuficiente) {
    return { texto: `Estoque insuficiente nesta filial (${item.estoqueDisponivel} de ${item.quantidadeExigida})`, informativo: false };
  }
  return { texto: "EPI indisponível", informativo: false };
}

const motivos = [
  { value: "PRIMEIRA_ENTREGA", label: "Primeira entrega" },
  { value: "SUBSTITUICAO", label: "Substituição" },
  { value: "TROCA", label: "Troca" },
  { value: "PERDA", label: "Perda" },
  { value: "DANIFICACAO", label: "Danificação" },
  { value: "VENCIMENTO", label: "Vencimento" },
  { value: "ADMISSAO", label: "Admissão" },
  { value: "OUTRO", label: "Outro" },
];

export default function NewDeliveryPage() {
  const [params] = useSearchParams();
  const employeeId = params.get("employeeId");
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState("PRIMEIRA_ENTREGA");
  const [extraPpeItemId, setExtraPpeItemId] = useState("");
  const [extraItems, setExtraItems] = useState<{ ppeItemId: string; nome: string; quantidade: number }[]>([]);
  const [createdDeliveryId, setCreatedDeliveryId] = useState<string | null>(null);
  const [nomeDigitado, setNomeDigitado] = useState("");
  const [concordo, setConcordo] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [pickerOpen, setPickerOpen] = useState(!employeeId);

  const { data, isLoading } = useQuery<PrepareResponse>({
    queryKey: ["deliveries", "prepare", employeeId],
    queryFn: async () => (await api.get(`/deliveries/prepare/${employeeId}`)).data,
    enabled: !!employeeId,
  });

  // Lista de EPIs disponíveis vem do estoque da filial do colaborador —
  // só faz sentido oferecer o que existe fisicamente naquele almoxarifado.
  const branchIdDoColaborador = data?.employee.branch?.id;
  const { data: branchStock } = useQuery<BranchStock[]>({
    queryKey: ["stock-current", branchIdDoColaborador],
    queryFn: async () => (await api.get("/stock/current", { params: { branchId: branchIdDoColaborador } })).data,
    enabled: !!branchIdDoColaborador,
  });

  const { data: kits } = useQuery<PpeKit[]>({
    queryKey: ["ppe-kits", "active"],
    queryFn: async () => (await api.get("/ppe-kits", { params: { status: "ATIVO" } })).data,
  });
  const [selectedKitId, setSelectedKitId] = useState("");

  const { data: organization } = useQuery<Organization>({
    queryKey: ["organization"],
    queryFn: async () => (await api.get("/organization")).data,
  });
  const fotoObrigatoria = organization?.exigirFotoConfirmacao ?? false;

  const createMutation = useMutation({
    mutationFn: async () => {
      const items = [
        ...Object.entries(selected)
          .filter(([, qty]) => qty > 0)
          .map(([ppeItemId, quantidade]) => ({ ppeItemId, quantidade })),
        ...extraItems.map((e) => ({ ppeItemId: e.ppeItemId, quantidade: e.quantidade })),
      ];
      const res = await api.post("/deliveries", { employeeId, motivo, items });
      return res.data;
    },
    onSuccess: (delivery) => {
      toast.success("Entrega registrada. Estoque atualizado. Prossiga com a confirmação eletrônica.");
      setCreatedDeliveryId(delivery.id);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      // multipart para enviar a foto capturada junto com a confirmação
      const formData = new FormData();
      formData.append("nomeDigitado", nomeDigitado);
      formData.append("concordo", "true");
      if (photo) formData.append("photo", photo);
      return api.post(`/deliveries/${createdDeliveryId}/confirm`, formData);
    },
    onSuccess: () => {
      toast.success("Entrega confirmada eletronicamente com sucesso.");
      navigate(`/entregas/${createdDeliveryId}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const nameMatches = useMemo(() => {
    if (!data) return false;
    const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
    return normalize(nomeDigitado) === normalize(data.employee.nomeCompleto);
  }, [nomeDigitado, data]);

  function toggleItem(item: SuggestedItem) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[item.ppeItem.id]) delete next[item.ppeItem.id];
      else next[item.ppeItem.id] = item.quantidadeExigida;
      return next;
    });
  }

  function addExtraItem() {
    if (!extraPpeItemId) return;
    const stock = branchStock?.find((s) => s.ppeItem.id === extraPpeItemId);
    if (!stock || extraItems.some((e) => e.ppeItemId === stock.ppeItem.id)) return;
    setExtraItems((prev) => [...prev, { ppeItemId: stock.ppeItem.id, nome: stock.ppeItem.nome, quantidade: 1 }]);
    setExtraPpeItemId("");
  }

  function applyKit() {
    const kit = kits?.find((k) => k.id === selectedKitId);
    if (!kit) return;
    setExtraItems((prev) => {
      const next = [...prev];
      for (const kitItem of kit.items) {
        const alreadySelected = selected[kitItem.ppeItemId] !== undefined;
        const existingExtra = next.find((e) => e.ppeItemId === kitItem.ppeItemId);
        if (alreadySelected) continue;
        if (existingExtra) existingExtra.quantidade = kitItem.quantidade;
        else next.push({ ppeItemId: kitItem.ppeItemId, nome: kitItem.ppeItem.nome, quantidade: kitItem.quantidade });
      }
      return next;
    });
    toast.success(`Itens do kit "${kit.nome}" adicionados. Revise as quantidades antes de confirmar.`);
    setSelectedKitId("");
  }

  if (!employeeId) {
    return (
      <div className="space-y-4">
        <EmptyState title="Selecione um colaborador para iniciar a entrega" />
        <EmployeePickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(id) => navigate(`/entregas/nova?employeeId=${id}`)} />
      </div>
    );
  }

  if (isLoading) return <Spinner label="Analisando matriz Cargo x EPI..." />;
  if (!data) return <EmptyState title="Colaborador não encontrado" />;

  const totalSelecionados = Object.values(selected).filter((q) => q > 0).length + extraItems.length;

  return (
    <div className="space-y-6">
      <button onClick={() => navigate("/entregas")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Voltar para entregas
      </button>

      <div>
        <h1 className="text-xl font-semibold text-slate-800">Nova entrega — {data.employee.nomeCompleto}</h1>
        <p className="text-sm text-slate-500">
          {data.employee.position?.nome ?? "Sem cargo definido"}
          {data.employee.branch && (
            <>
              {" · "}
              <span className="font-medium text-navy-700">{data.employee.branch.nome}</span>
            </>
          )}
        </p>
        {data.employee.branch && (
          <p className="text-xs text-slate-400">
            O estoque considerado é o de <strong>{data.employee.branch.nome}</strong>.
          </p>
        )}
      </div>

      {!createdDeliveryId ? (
        <>
          <Card>
            <CardHeader title="EPIs sugeridos pela Matriz Cargo x EPI" subtitle="Itens analisados automaticamente a partir do cargo do colaborador" />
            <CardBody className="p-0">
              {data.itensSugeridos.length === 0 ? (
                <EmptyState title="Nenhum EPI obrigatório configurado para este cargo" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.itensSugeridos.map((item) => (
                    <li key={item.requirementId} className="flex items-center gap-4 px-5 py-3 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        disabled={!item.podeEntregar}
                        checked={!!selected[item.ppeItem.id]}
                        onChange={() => toggleItem(item)}
                      />
                      <div className="flex-1">
                        <p className="font-medium text-slate-700">{item.ppeItem.nome}</p>
                        <p className="text-xs text-slate-400">
                          {item.ppeItem.ca ? `CA ${item.ppeItem.ca} · ` : ""}Estoque: {item.estoqueDisponivel} · Exigido:{" "}
                          {item.quantidadeExigida}
                        </p>
                        {!item.podeEntregar && (
                          <p className={`flex items-center gap-1 text-xs ${motivoBloqueio(item).informativo ? "text-amber-600" : "text-red-600"}`}>
                            <AlertTriangle className="h-3 w-3" />
                            {motivoBloqueio(item).texto}
                          </p>
                        )}
                      </div>
                      <StatusBadge status={item.status} />
                      {selected[item.ppeItem.id] !== undefined && (
                        <Input
                          type="number"
                          min={1}
                          className="w-20"
                          value={selected[item.ppeItem.id]}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [item.ppeItem.id]: Number(e.target.value) }))}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {!!kits?.length && (
            <Card>
              <CardHeader title="Entregar kit" subtitle="Carrega automaticamente todos os itens de um kit para revisão" />
              <CardBody>
                <div className="flex gap-2">
                  <Select className="flex-1" value={selectedKitId} onChange={(e) => setSelectedKitId(e.target.value)}>
                    <option value="">Selecione um kit...</option>
                    {kits.map((k) => <option key={k.id} value={k.id}>{k.nome} ({k.items.length} itens)</option>)}
                  </Select>
                  <Button variant="outline" type="button" onClick={applyKit} disabled={!selectedKitId}>Entregar kit</Button>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Adicionar outro EPI" subtitle="Itens fora da matriz do cargo, se necessário" />
            <CardBody>
              <div className="flex gap-2">
                <Select className="flex-1" value={extraPpeItemId} onChange={(e) => setExtraPpeItemId(e.target.value)}>
                  <option value="">Selecione um EPI...</option>
                  {branchStock?.map((s) => (
                    <option key={s.ppeItem.id} value={s.ppeItem.id} disabled={s.estoqueAtual <= 0}>
                      {s.ppeItem.nome} (estoque: {s.estoqueAtual})
                    </option>
                  ))}
                </Select>
                <Button variant="outline" onClick={addExtraItem}>Adicionar</Button>
              </div>
              {extraItems.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {extraItems.map((e, idx) => (
                    <li key={e.ppeItemId} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>{e.nome}</span>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          className="w-20"
                          value={e.quantidade}
                          onChange={(ev) => setExtraItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantidade: Number(ev.target.value) } : it)))}
                        />
                        <Button variant="ghost" size="sm" onClick={() => setExtraItems((prev) => prev.filter((_, i) => i !== idx))}>Remover</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Revisão e confirmação da entrega" />
            <CardBody className="space-y-4">
              <Select label="Motivo da entrega" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {motivos.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
              <InlineBanner tone="info">{totalSelecionados} item(ns) selecionado(s) para entrega.</InlineBanner>
              <Button disabled={totalSelecionados === 0} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
                Confirmar entrega e dar baixa no estoque
              </Button>
            </CardBody>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader title="Confirmação de entrega" />
          <CardBody className="space-y-4">
            <InlineBanner tone="success">
              <CheckCircle2 className="mr-1 inline h-4 w-4" /> Entrega registrada e estoque atualizado. Agora solicite a confirmação eletrônica de recebimento ao colaborador.
            </InlineBanner>

            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              Declaro que recebi os EPIs relacionados nesta entrega em perfeitas condições de uso e estou ciente da
              responsabilidade pela utilização, conservação, guarda e comunicação de qualquer necessidade de
              substituição. Estou ciente de que, em caso de dano, extravio ou não devolução por minha
              responsabilidade, o valor do equipamento poderá ser descontado da minha remuneração, nos termos do
              artigo 462, § 1º, da CLT.
            </p>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <p>
                Colaborador: <strong className="text-slate-800">{data.employee.nomeCompleto}</strong>
              </p>
              {data.employee.branch && <p>Filial: {data.employee.branch.nome}</p>}
              <p>
                Data e hora da entrega:{" "}
                <strong className="text-slate-800">{new Date().toLocaleString("pt-BR")}</strong>
              </p>
            </div>

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
            {fotoObrigatoria && !photo && (
              <InlineBanner tone="warning">
                Esta empresa exige a foto do colaborador para concluir a confirmação de recebimento.
              </InlineBanner>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} className="h-4 w-4" />
              Confirmo que li e concordo com a declaração acima.
            </label>

            <div className="flex items-center gap-2">
              <Button
                disabled={!nameMatches || !concordo || (fotoObrigatoria && !photo)}
                loading={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
              >
                Confirmar entrega
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={async () => {
                  try {
                    await openPdfFromApi(`/deliveries/${createdDeliveryId}/termo.pdf`, `termo-entrega-${createdDeliveryId}.pdf`);
                  } catch (err) {
                    toast.error(extractErrorMessage(err));
                  }
                }}
              >
                <FileDown className="h-4 w-4" /> Ver termo (rascunho)
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
