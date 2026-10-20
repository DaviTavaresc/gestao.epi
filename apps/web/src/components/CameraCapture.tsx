import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, X, CheckCircle2, SwitchCamera } from "lucide-react";
import { Button } from "./ui/Button";
import { InlineBanner } from "./ui/Feedback";

type Props = {
  // Recebe o arquivo pronto para upload (JPEG comprimido) ou null quando a foto é descartada.
  onCapture: (file: File | null) => void;
  label?: string;
  required?: boolean;
};

// Captura de foto pela câmera do notebook ou do celular, no estilo do registro de ponto.
// Requer contexto seguro: funciona em localhost e em HTTPS.
export function CameraCapture({ onCapture, label = "Foto do recebimento", required }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [starting, setStarting] = useState(false);
  const active = !!stream;

  const stopCamera = useCallback(() => {
    setStream((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  // O elemento <video> só existe no DOM depois que o stream entra no estado,
  // então a ligação precisa acontecer em um efeito — não logo após o getUserMedia.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => undefined);
  }, [stream]);

  // Garante que a câmera seja liberada ao sair da tela.
  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera(mode: "user" | "environment" = facingMode) {
    setError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Este navegador não permite acesso à câmera. Use HTTPS ou um navegador atualizado.");
      }
      stopCamera();
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setPreview(null);
      onCapture(null);
      setStream(nextStream);
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Permissão de câmera negada. Autorize o acesso no navegador para registrar a foto."
          : err instanceof DOMException && err.name === "NotFoundError"
          ? "Nenhuma câmera encontrada neste dispositivo."
          : err instanceof Error
          ? err.message
          : "Não foi possível acessar a câmera.";
      setError(message);
      stopCamera();
    } finally {
      setStarting(false);
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;

    // Sem dimensões o quadro ainda não chegou — avisar é melhor que gerar uma imagem vazia.
    if (!video.videoWidth || !video.videoHeight) {
      setError("A imagem da câmera ainda não carregou. Aguarde um instante e tente novamente.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `confirmacao-${Date.now()}.jpg`, { type: "image/jpeg" });
        setPreview(URL.createObjectURL(blob));
        onCapture(file);
        stopCamera();
      },
      "image/jpeg",
      0.85
    );
  }

  function discard() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    onCapture(null);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </p>

      {error && <InlineBanner tone="error">{error}</InlineBanner>}

      {preview ? (
        <div className="space-y-2">
          <div className="relative inline-block">
            <img src={preview} alt="Foto do recebimento" className="max-h-64 rounded-lg border border-slate-200" />
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-xs font-medium text-white">
              <CheckCircle2 className="h-3 w-3" /> Foto capturada
            </span>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => startCamera()}>
              <RefreshCw className="h-4 w-4" /> Tirar outra
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={discard}>
              <X className="h-4 w-4" /> Descartar
            </Button>
          </div>
        </div>
      ) : active ? (
        <div className="space-y-2">
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-64 w-full max-w-sm rounded-lg border border-slate-200 bg-slate-900 object-cover"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={capture}>
              <Camera className="h-4 w-4" /> Capturar foto
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next = facingMode === "user" ? "environment" : "user";
                setFacingMode(next);
                startCamera(next);
              }}
            >
              <SwitchCamera className="h-4 w-4" /> Trocar câmera
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={stopCamera}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" loading={starting} onClick={() => startCamera()}>
          <Camera className="h-4 w-4" /> Abrir câmera
        </Button>
      )}
    </div>
  );
}
