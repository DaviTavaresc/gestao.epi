import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud } from "lucide-react";
import { api, extractErrorMessage } from "../lib/api";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { InlineBanner } from "./ui/Feedback";
import { toast } from "../stores/toastStore";

type PreviewRow = { row: number; data: Record<string, string>; errors: string[] };
type PreviewResult = { total: number; validas: number; invalidas: number; linhas: PreviewRow[] };

export function ImportExcelModal({
  open,
  onClose,
  type,
  columnsHint,
  invalidateKey,
}: {
  open: boolean;
  onClose: () => void;
  type: "employees" | "ppeItems" | "positions" | "departments";
  columnsHint: string;
  invalidateKey: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handlePreview() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post(`/imports/${type}/preview`, formData);
      setPreview(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post(`/imports/${type}/commit`, formData);
      toast.success(`${data.imported} registro(s) importado(s) com sucesso.`);
      queryClient.invalidateQueries({ queryKey: [invalidateKey] });
      reset();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Importar planilha Excel"
      size="lg"
      footer={
        !preview ? (
          <Button loading={loading} disabled={!file} onClick={handlePreview}>
            Validar planilha
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={reset}>Escolher outro arquivo</Button>
            <Button loading={loading} disabled={preview.invalidas > 0} onClick={handleCommit}>
              Confirmar importação ({preview.validas})
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <InlineBanner tone="info">
          A planilha deve conter a primeira linha com os cabeçalhos: <code className="font-mono">{columnsHint}</code>
        </InlineBanner>
        {error && <InlineBanner tone="error">{error}</InlineBanner>}

        {!preview && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 py-10">
            <UploadCloud className="h-8 w-8 text-slate-300" />
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            {file && <p className="text-sm text-slate-500">{file.name}</p>}
          </div>
        )}

        {preview && (
          <div>
            <div className="mb-3 flex gap-4 text-sm">
              <span className="text-slate-600">Total: {preview.total}</span>
              <span className="text-emerald-600">Válidas: {preview.validas}</span>
              <span className="text-red-600">Inválidas: {preview.invalidas}</span>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2">Linha</th>
                    <th className="px-3 py-2">Dados</th>
                    <th className="px-3 py-2">Erros</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.linhas.map((l) => (
                    <tr key={l.row} className={l.errors.length ? "bg-red-50" : ""}>
                      <td className="px-3 py-2 align-top">{l.row}</td>
                      <td className="px-3 py-2 align-top">{Object.values(l.data).join(" · ")}</td>
                      <td className="px-3 py-2 align-top text-red-600">{l.errors.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
