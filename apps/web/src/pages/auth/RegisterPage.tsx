import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { Input } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { InlineBanner } from "../../components/ui/Feedback";
import { useRegisterOrganization } from "../../hooks/useAuth";
import { extractErrorMessage } from "../../lib/api";

type FormData = {
  razaoSocial: string;
  nomeFantasia?: string;
  cnpj: string;
  telefone?: string;
  adminName: string;
  adminEmail: string;
  password: string;
  confirmPassword: string;
};

export default function RegisterPage() {
  const { register, handleSubmit, watch, formState } = useForm<FormData>();
  const registerOrg = useRegisterOrganization();

  function onSubmit(data: FormData) {
    registerOrg.mutate({
      organization: {
        razaoSocial: data.razaoSocial,
        nomeFantasia: data.nomeFantasia,
        cnpj: data.cnpj.replace(/\D/g, ""),
        telefone: data.telefone,
      },
      admin: { name: data.adminName, email: data.adminEmail, password: data.password },
    });
  }

  return (
    <AuthLayout title="Cadastrar empresa" subtitle="Crie a conta da sua empresa no sistema">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {registerOrg.isError && <InlineBanner tone="error">{extractErrorMessage(registerOrg.error)}</InlineBanner>}

        <p className="text-xs font-semibold uppercase text-slate-400">Dados da empresa</p>
        <Input label="Razão social" required error={formState.errors.razaoSocial?.message} {...register("razaoSocial", { required: "Obrigatório." })} />
        <Input label="Nome fantasia" {...register("nomeFantasia")} />
        <Input label="CNPJ" required error={formState.errors.cnpj?.message} {...register("cnpj", { required: "Obrigatório." })} />
        <Input label="Telefone" {...register("telefone")} />

        <p className="pt-2 text-xs font-semibold uppercase text-slate-400">Usuário administrador</p>
        <Input label="Nome completo" required error={formState.errors.adminName?.message} {...register("adminName", { required: "Obrigatório." })} />
        <Input label="E-mail" type="email" required error={formState.errors.adminEmail?.message} {...register("adminEmail", { required: "Obrigatório." })} />
        <Input
          label="Senha"
          type="password"
          required
          hint="Mínimo de 8 caracteres"
          error={formState.errors.password?.message}
          {...register("password", { required: "Obrigatório.", minLength: { value: 8, message: "Mínimo de 8 caracteres." } })}
        />
        <Input
          label="Confirmar senha"
          type="password"
          required
          error={formState.errors.confirmPassword?.message}
          {...register("confirmPassword", {
            required: "Obrigatório.",
            validate: (value) => value === watch("password") || "As senhas não coincidem.",
          })}
        />

        <Button type="submit" className="w-full" loading={registerOrg.isPending}>
          Criar conta
        </Button>

        <p className="text-center text-sm text-slate-500">
          Já tem uma conta?{" "}
          <Link to="/login" className="font-medium text-navy-600 hover:underline">
            Entrar
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
