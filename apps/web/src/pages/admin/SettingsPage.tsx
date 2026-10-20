import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { Organization } from "../../types";
import { Card, CardHeader, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Field";
import { InlineBanner } from "../../components/ui/Feedback";
import { toast } from "../../stores/toastStore";
import { useAuthStore } from "../../stores/authStore";

type FormData = {
  razaoSocial: string;
  nomeFantasia?: string;
  telefone?: string;
  email?: string;
  endereco?: string;
  alertDaysProximo: number;
  alertDaysAtencao: number;
  alertDaysCritico: number;
  exigirFotoConfirmacao: boolean;
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setSession = useAuthStore((s) => s.setSession);
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  const { data: organization, isLoading } = useQuery<Organization>({
    queryKey: ["organization"],
    queryFn: async () => (await api.get("/organization")).data,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  useEffect(() => {
    if (organization) {
      reset({
        razaoSocial: organization.razaoSocial,
        nomeFantasia: organization.nomeFantasia ?? "",
        telefone: organization.telefone ?? "",
        email: organization.email ?? "",
        endereco: organization.endereco ?? "",
        alertDaysProximo: organization.alertDaysProximo,
        alertDaysAtencao: organization.alertDaysAtencao,
        alertDaysCritico: organization.alertDaysCritico,
        exigirFotoConfirmacao: organization.exigirFotoConfirmacao,
      });
    }
  }, [organization, reset]);

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) => api.put("/organization", values),
    onSuccess: (res) => {
      toast.success("Configurações salvas com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      if (accessToken && user) setSession({ accessToken, user, organization: res.data });
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const logoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("logo", file);
      return api.post("/organization/logo", formData);
    },
    onSuccess: (res) => {
      toast.success("Logo atualizada com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      if (accessToken && user) setSession({ accessToken, user, organization: res.data });
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  if (isLoading || !organization) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Configurações</h1>
        <p className="text-sm text-slate-500">Dados da empresa e parâmetros de alertas do sistema.</p>
      </div>

      <Card>
        <CardHeader title="Empresa" />
        <CardBody className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {organization.logoUrl ? (
                <img src={organization.logoUrl} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-slate-400">Sem logo</span>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) logoMutation.mutate(file);
              e.target.value = "";
            }} />
            <Button variant="outline" loading={logoMutation.isPending} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> Alterar logo
            </Button>
          </div>

          <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
            {saveMutation.isError && <div className="sm:col-span-2"><InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner></div>}
            <Input label="Razão social" required error={formState.errors.razaoSocial?.message} {...register("razaoSocial", { required: "Obrigatório." })} />
            <Input label="Nome fantasia" {...register("nomeFantasia")} />
            <Input label="CNPJ" value={organization.cnpj} disabled hint="O CNPJ não pode ser alterado" />
            <Input label="Telefone" {...register("telefone")} />
            <Input label="E-mail" type="email" {...register("email")} />
            <Input label="Endereço" {...register("endereco")} />

            <div className="sm:col-span-2 border-t border-slate-100 pt-4">
              <p className="mb-3 text-sm font-medium text-slate-700">Configuração de alertas (dias de antecedência)</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input label="Próximo da troca/vencimento" type="number" min={1} {...register("alertDaysProximo", { valueAsNumber: true, min: 1 })} />
                <Input label="Atenção" type="number" min={1} {...register("alertDaysAtencao", { valueAsNumber: true, min: 1 })} />
                <Input label="Crítico" type="number" min={1} {...register("alertDaysCritico", { valueAsNumber: true, min: 1 })} />
              </div>
            </div>

            <div className="sm:col-span-2 border-t border-slate-100 pt-4">
              <p className="mb-3 text-sm font-medium text-slate-700">Confirmação de recebimento</p>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" {...register("exigirFotoConfirmacao")} />
                <span>
                  <span className="font-medium text-slate-700">Exigir foto do colaborador na confirmação</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Quando ativado, a entrega só pode ser confirmada com uma foto capturada pela câmera no momento do
                    recebimento (como no registro de ponto). A foto fica anexada ao termo de entrega.
                  </span>
                </span>
              </label>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" loading={saveMutation.isPending}>Salvar configurações</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
