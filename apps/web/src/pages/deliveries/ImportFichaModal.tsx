import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Search, X } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { Employee, Page, PpeItem } from "../../types";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Input, Select, Textarea } from "../../components/ui/Field";
import { InlineBanner, Spinner } from "../../components/ui/Feedback";
import { toast } from "../../stores/toastStore";

const MOTIVOS = [
  { valor: "ADMISSAO", texto: "Admissão" },
  { valor: "PRIMEIRA_ENTREGA", texto: "Primeira entrega" },
  { valor: "TROCA", texto: "Troca" },
  { valor: "SUBSTITUICAO", texto: "Substituição" },
  { valor: "VENCIMENTO", texto: "Vencimento" },
  { valor: "PERDA", texto: "Perda" },
  { valor: "DANIFICACAO", texto: "Danificação" },
  { valor: "OUTRO", texto: "Outro / não informado na ficha" },
];

const TAMANHO_MAXIMO = 10 * 1024 * 1024;

// Lança no sistema uma entrega que já aconteceu, a partir da ficha de EPI assinada
// em papel. A ficha digitalizada é a prova do recebimento, e os EPIs marcados aqui
// é que fazem o colaborador aparecer com EPI ativo e gerar alerta de troca.
export function ImportFichaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [buscaColaborador, setBuscaColaborador] = useState("");
  const [colaborador, setColaborador] = useState<Employee | null>(null);
  const [dataFicha, setDataFicha] = useState("");
  const [motivo, setMotivo] = useState("OUTRO");
  const [observacoes, setObservacoes] = useState("");
  const [buscaEpi, setBuscaEpi] = useState("");
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const hoje = new Date().toISOString().slice(0, 10);

  // Sem filtro de status: a ficha de quem já foi desligado continua sendo
  // histórico de EPI, e é justamente o histórico que se quer trazer para cá.
  const { data: colaboradores, isLoading: carregandoColaboradores } = useQuery<Page<Employee>>({
    queryKey: ["employees", "ficha-picker", buscaColaborador],
    queryFn: async () =>
      (await api.get("/employees", { params: { search: buscaColaborador, pageSize: 20 } })).data,
    enabled: open && !colaborador,
  });

  const { data: epis } = useQuery<Page<PpeItem>>({
    queryKey: ["ppe-items", "all"],
    queryFn: async () => (await api.get("/ppe-items", { params: { pageSize: 200 } })).data,
    enabled: open,
  });

  const episFiltrados = useMemo(() => {
    const termo = buscaEpi.trim().toLowerCase();
    const lista = epis?.items ?? [];
    if (!termo) return lista;
    return lista.filter(
      (i) => i.nome.toLowerCase().includes(termo) || i.codigoInterno.toLowerCase().includes(termo)
    );
  }, [epis, buscaEpi]);

  const selecionados = Object.entries(quantidades).filter(([, q]) => q > 0);

  function limpar() {
    setBuscaColaborador("");
    setColaborador(null);
    setDataFicha("");
    setMotivo("OUTRO");
    setObservacoes("");
    setBuscaEpi("");
    setQuantidades({});
    setArquivo(null);
    setErro(null);
    if (inputArquivo.current) inputArquivo.current.value = "";
  }

  function fechar() {
    limpar();
    onClose();
  }

  function escolherArquivo(file: File | null) {
    setErro(null);
    if (!file) {
      setArquivo(null);
      return;
    }
    if (file.size > TAMANHO_MAXIMO) {
      setErro("O arquivo tem mais de 10 MB. Digitalize em resolução menor ou em preto e branco.");
      if (inputArquivo.current) inputArquivo.current.value = "";
      return;
    }
    setArquivo(file);
  }

  async function salvar() {
    setErro(null);
    if (!colaborador) return setErro("Selecione o colaborador da ficha.");
    if (!dataFicha) return setErro("Informe a data que consta na ficha assinada.");
    if (dataFicha > hoje) return setErro("A data da ficha está no futuro.");
    if (selecionados.length === 0) {
      return setErro("Marque ao menos um EPI, com a quantidade que consta na ficha.");
    }
    if (!arquivo) return setErro("Anexe a ficha digitalizada (PDF, JPG ou PNG).");

    setSalvando(true);
    try {
      const form = new FormData();
      form.append("ficha", arquivo);
      form.append("employeeId", colaborador.id);
      form.append("dataFicha", dataFicha);
      form.append("motivo", motivo);
      if (observacoes.trim()) form.append("observacoes", observacoes.trim());
      form.append(
        "items",
        JSON.stringify(selecionados.map(([ppeItemId, quantidade]) => ({ ppeItemId, quantidade })))
      );

      await api.post("/deliveries/importar-ficha", form);

      // O histórico e os "EPIs atuais" do colaborador mudam, e a lista de
      // entregas ganha a ficha: as três precisam ser recarregadas.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
        queryClient.invalidateQueries({ queryKey: ["employee", colaborador.id] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      toast.success(`Ficha de ${colaborador.nomeCompleto} importada e anexada ao histórico.`);
      fechar();
    } catch (err) {
      setErro(extractErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Importar ficha de EPI em papel"
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando}>
            Importar ficha
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <InlineBanner tone="info">
          A ficha entra como entrega <strong>já confirmada</strong>, com a data do papel, e o PDF fica
          anexado como prova do recebimento. Ela <strong>não baixa estoque</strong>, porque a saída do
          almoxarifado aconteceu antes do sistema. Os EPIs marcados aqui passam a contar como EPI ativo
          do colaborador e entram no cálculo da próxima troca.
        </InlineBanner>

        {/* ---------- colaborador ---------- */}
        {colaborador ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-sm">
              <p className="font-medium text-slate-700">{colaborador.nomeCompleto}</p>
              <p className="text-slate-500">
                Matrícula {colaborador.matricula} · {colaborador.position?.nome ?? "sem cargo"}
                {colaborador.status !== "ATIVO" && (
                  <span className="ml-2 text-amber-700">({colaborador.status.toLowerCase()})</span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setColaborador(null)}
              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              aria-label="Trocar colaborador"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              label="Colaborador da ficha"
              required
              autoFocus
              placeholder="Buscar por nome, CPF ou matrícula..."
              value={buscaColaborador}
              onChange={(e) => setBuscaColaborador(e.target.value)}
              hint="Inclui colaborador desligado ou afastado: a ficha dele também é histórico."
            />
            {carregandoColaboradores ? (
              <Spinner />
            ) : (
              <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {(colaboradores?.items ?? []).length === 0 ? (
                  <li className="px-3 py-3 text-sm text-slate-400">Nenhum colaborador encontrado.</li>
                ) : (
                  colaboradores!.items.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setColaborador(e)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span>
                          <span className="font-medium text-slate-700">{e.nomeCompleto}</span>
                          <span className="ml-2 text-slate-400">{e.matricula}</span>
                        </span>
                        <span className="text-slate-400">{e.position?.nome ?? "-"}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        )}

        {/* ---------- data e motivo ---------- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            type="date"
            label="Data da entrega na ficha"
            required
            max={hoje}
            value={dataFicha}
            onChange={(e) => setDataFicha(e.target.value)}
            hint="A data que está escrita no papel, não a de hoje. É dela que sai o prazo de troca."
          />
          <Select label="Motivo da entrega" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {MOTIVOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.texto}
              </option>
            ))}
          </Select>
        </div>

        {/* ---------- EPIs ---------- */}
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-3">
            <Input
              label="EPIs que constam na ficha"
              required
              placeholder="Filtrar por nome ou código..."
              value={buscaEpi}
              onChange={(e) => setBuscaEpi(e.target.value)}
              className="flex-1"
            />
            <span className="whitespace-nowrap pb-2 text-sm text-slate-500">
              {selecionados.length} marcado(s)
            </span>
          </div>
          <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {!epis ? (
              <div className="p-3">
                <Spinner />
              </div>
            ) : episFiltrados.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-400">
                <Search className="mr-1 inline h-4 w-4" />
                Nenhum EPI encontrado.
              </p>
            ) : (
              episFiltrados.map((item) => {
                const quantidade = quantidades[item.id] ?? 0;
                return (
                  <div key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={quantidade > 0}
                      onChange={(e) =>
                        setQuantidades((atual) => ({ ...atual, [item.id]: e.target.checked ? 1 : 0 }))
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="flex-1">
                      <span className="font-medium text-slate-700">{item.nome}</span>
                      <span className="ml-2 text-slate-400">{item.codigoInterno}</span>
                      {item.ca && <span className="ml-2 text-slate-400">CA {item.ca}</span>}
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={quantidade > 0 ? quantidade : ""}
                      disabled={quantidade === 0}
                      onChange={(e) =>
                        setQuantidades((atual) => ({
                          ...atual,
                          [item.id]: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                      aria-label={`Quantidade de ${item.nome}`}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ---------- arquivo ---------- */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            Ficha digitalizada <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              ref={inputArquivo}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
              className="hidden"
              id="ficha-arquivo"
            />
            <label
              htmlFor="ficha-arquivo"
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <FileUp className="h-4 w-4" />
              Escolher arquivo
            </label>
            <span className="truncate text-sm text-slate-500">
              {arquivo ? `${arquivo.name} (${(arquivo.size / 1024).toFixed(0)} KB)` : "PDF, JPG ou PNG, até 10 MB"}
            </span>
          </div>
        </div>

        <Textarea
          label="Observações"
          rows={2}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          hint="Opcional. Ex.: ficha arquivada na pasta física do colaborador."
        />

        {erro && <InlineBanner tone="error">{erro}</InlineBanner>}
      </div>
    </Modal>
  );
}
