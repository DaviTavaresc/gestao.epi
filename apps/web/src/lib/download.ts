import { api } from "./api";

// Abre um PDF protegido em nova aba. A tag <a href> não envia o header Authorization,
// então o arquivo precisa ser buscado pelo cliente autenticado e exibido via object URL.
// A aba é aberta no clique (síncrono) para não ser barrada pelo bloqueador de pop-up.
export async function openPdfFromApi(url: string, filename: string) {
  const janela = window.open("", "_blank");
  try {
    const response = await api.get(url, { responseType: "blob" });
    const blobUrl = window.URL.createObjectURL(response.data as Blob);

    if (janela) {
      janela.location.href = blobUrl;
    } else {
      // Pop-up bloqueado: cai para download do arquivo.
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    janela?.close();
    throw err;
  }
}

export async function downloadFromApi(url: string, params: Record<string, unknown>, filename: string) {
  const response = await api.get(url, { params, responseType: "blob" });
  const blobUrl = window.URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}
