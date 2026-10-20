import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Spinner } from "./ui/Feedback";

// Imagens protegidas (como a foto da confirmação) exigem o header Authorization,
// que uma tag <img> não envia. Buscamos o arquivo pelo cliente autenticado e
// exibimos a partir de um object URL.
export function AuthenticatedImage({
  url,
  alt,
  className,
}: {
  url: string;
  alt: string;
  className?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let created: string | null = null;

    api
      .get(url, { responseType: "blob" })
      .then((res) => {
        if (revoked) return;
        created = URL.createObjectURL(res.data as Blob);
        setObjectUrl(created);
      })
      .catch(() => setError(true));

    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  if (error) return <p className="text-sm text-slate-400">Não foi possível carregar a imagem.</p>;
  if (!objectUrl) return <Spinner label="Carregando imagem..." />;

  return <img src={objectUrl} alt={alt} className={className} />;
}
