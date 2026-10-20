import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { Input } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { InlineBanner } from "../../components/ui/Feedback";
import { useForgotPassword } from "../../hooks/useAuth";

export default function ForgotPasswordPage() {
  const { register, handleSubmit } = useForm<{ email: string }>();
  const forgot = useForgotPassword();

  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos instruções para redefinir sua senha">
      {forgot.isSuccess ? (
        <div className="space-y-4">
          <InlineBanner tone="success">{forgot.data.message}</InlineBanner>
          {forgot.data.devResetToken && (
            <InlineBanner tone="info">
              Ambiente de desenvolvimento — nenhum provedor de e-mail configurado. Use este token em{" "}
              <Link to="/redefinir-senha" className="font-medium underline">
                Redefinir senha
              </Link>
              : <code className="break-all">{forgot.data.devResetToken}</code>
            </InlineBanner>
          )}
          <Link to="/login" className="block text-center text-sm font-medium text-navy-600 hover:underline">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit((data) => forgot.mutate(data.email))} className="space-y-4">
          <Input label="E-mail" type="email" required {...register("email", { required: true })} />
          <Button type="submit" className="w-full" loading={forgot.isPending}>
            Enviar instruções
          </Button>
          <Link to="/login" className="block text-center text-sm text-slate-500 hover:underline">
            Voltar para o login
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
