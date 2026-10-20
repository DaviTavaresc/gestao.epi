import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { Input } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { InlineBanner } from "../../components/ui/Feedback";
import { useLogin } from "../../hooks/useAuth";
import { extractErrorMessage } from "../../lib/api";

type FormData = { email: string; password: string };

export default function LoginPage() {
  const { register, handleSubmit, formState } = useForm<FormData>();
  const login = useLogin();

  return (
    <AuthLayout title="Entrar" subtitle="Acesse sua conta para continuar">
      <form onSubmit={handleSubmit((data) => login.mutate(data))} className="space-y-4">
        {login.isError && <InlineBanner tone="error">{extractErrorMessage(login.error)}</InlineBanner>}

        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          error={formState.errors.email?.message}
          {...register("email", { required: "Informe o e-mail." })}
        />
        <Input
          label="Senha"
          type="password"
          autoComplete="current-password"
          error={formState.errors.password?.message}
          {...register("password", { required: "Informe a senha." })}
        />

        <div className="flex justify-end">
          <Link to="/esqueci-senha" className="text-sm text-navy-600 hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        <Button type="submit" className="w-full" loading={login.isPending}>
          Entrar
        </Button>

        <p className="text-center text-sm text-slate-500">
          Ainda não tem uma conta?{" "}
          <Link to="/registrar" className="font-medium text-navy-600 hover:underline">
            Cadastre sua empresa
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
