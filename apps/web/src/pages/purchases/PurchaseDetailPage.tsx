import { useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageCheck, Ban, Upload, FileText, Download } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { openPdfFromApi } from "../../lib/download";
import { Purchase } from "../../types";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner, EmptyState, InlineBanner } from "../../components/ui/Feedback";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";
import { useState } from "react";

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["ALMOXARIFADO"]);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data: purchase, isLoading } = useQuery<Purchase>({
    queryKey: ["purchase", id],
    queryFn: async () => (await api.get(`/purchases/${id}`)).data,
  });

  const receiveMutation = useMutation({
    mutationFn: async () => api.post(`/purchases/${id}/receive`),
    onSuccess: () => {
      toast.success("Compra recebida! Estoque atualizado.");
      queryClient.invalidateQueries({ queryKey: ["purchase", id] });
      setConfirmReceive(false);
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err));
      setConfirmReceive(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => api.patch(`/purchases/${id}/cancel`),
    onSuccess: () => {
      toast.success("Compra cancelada.");
      queryClient.invalidateQueries({ queryKey: ["purchase", id] });
      setConfirmCancel(false);
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err));
      setConfirmCancel(false);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/documents/purchases/${id}`, formData);
    },
    onSuccess: () => {
      toast.success("Documento anexado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["purchase", id] });
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  if (isLoading) return <Spinner />;
  if (!purchase) return <EmptyState title="Compra não encontrada" />;

  return (
    <div className="space-y-6">
      <button onClick={() => navigate("/compras")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Voltar para compras
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">NF {purchase.numeroNf}</h1>
          <p className="text-sm text-slate-500">
            {purchase.supplier.razaoSocial} · {new Date(purchase.dataCompra).toLocaleDateString("pt-BR")}
            {purchase.branch && <> · Entrada na <span className="font-medium text-navy-700">{purchase.branch.nome}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={purchase.status} />
          {canEdit && purchase.status === "RASCUNHO" && (
            <>
              <Button onClick={() => setConfirmReceive(true)}><PackageCheck className="h-4 w-4" /> Marcar como recebida</Button>
              <Button variant="danger" onClick={() => setConfirmCancel(true)}><Ban className="h-4 w-4" /> Cancelar</Button>
            </>
          )}
        </div>
      </div>

      {purchase.status === "RASCUNHO" && (
        <InlineBanner tone="warning">
          Esta compra ainda não deu entrada no estoque. Marque como "Recebida" para registrar a entrada e atualizar os custos.
        </InlineBanner>
      )}

      <Card>
        <CardHeader title="Itens da compra" />
        <CardBody className="p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <th className="px-5 py-3">EPI</th>
                <th className="px-5 py-3">Qtd</th>
                <th className="px-5 py-3">Valor unit.</th>
                <th className="px-5 py-3">Valor total</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((item) => (
                <tr key={item.id} className="border-b border-slate-50">
                  <td className="px-5 py-3">{item.ppeItem.nome}</td>
                  <td className="px-5 py-3">{item.quantidade}</td>
                  <td className="px-5 py-3">R$ {Number(item.valorUnitario).toFixed(2)}</td>
                  <td className="px-5 py-3">R$ {Number(item.valorTotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 py-3 text-right text-sm font-semibold text-slate-700">Total: R$ {Number(purchase.valorTotal).toFixed(2)}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Documentos (NF, anexos)"
          actions={
            canEdit && (
              <>
                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                  e.target.value = "";
                }} />
                <Button variant="outline" size="sm" loading={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Anexar documento
                </Button>
              </>
            )
          }
        />
        <CardBody className="p-0">
          {!purchase.documents?.length ? (
            <EmptyState title="Nenhum documento anexado" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {purchase.documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="flex items-center gap-2 text-slate-700">
                    <FileText className="h-4 w-4 text-slate-400" /> {doc.fileName}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await openPdfFromApi(`/documents/${doc.id}/download`, doc.fileName);
                      } catch (err) {
                        toast.error(extractErrorMessage(err));
                      }
                    }}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmReceive}
        title="Confirmar recebimento"
        message="Ao confirmar, o estoque dos EPIs desta compra será atualizado e não será possível reverter esta ação."
        confirmLabel="Confirmar recebimento"
        loading={receiveMutation.isPending}
        onConfirm={() => receiveMutation.mutate()}
        onClose={() => setConfirmReceive(false)}
      />
      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar compra"
        message="Tem certeza que deseja cancelar esta compra? Esta ação não poderá ser desfeita."
        confirmLabel="Cancelar compra"
        tone="danger"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
        onClose={() => setConfirmCancel(false)}
      />
    </div>
  );
}
