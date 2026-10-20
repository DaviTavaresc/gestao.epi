import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { Input } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { InlineBanner } from "../../components/ui/Feedback";
import { useResetPassword } from "../../hooks/useAuth";
import { extractErrorMessage } from "../../lib/api";

type FormData = { token: string; newPassword: string; confirmPassword: string };

export default function ResetPasswordPage() {
  const { register, handleSubmit, watch, formState } = useForm<FormData>();
  const resetPassword = useResetPassword();

  return (
    <AuthLayout title="Redefinir senha">
      <form onSubmit={handleSubmit((data) => resetPassword.mutate({ token: data.token, newPassword: data.newPassword }))} className="space-y-4">
        {resetPassword.isError && <InlineBanner tone="error">{extractErrorMessage(resetPassword.error)}</InlineBanner>}

        <Input label="Token de redefinição" required {...register("token", { required: true })} />
        <Input
          label="Nova senha"
          type="password"
          required
          error={formState.errors.newPassword?.message}
          {...register("newPassword", { required: "Obrigatório.", minLength: { value: 8, message: "Mínimo de 8 caracteres." } })}
        />
        <Input
          label="Confirmar nova senha"
          type="password"
          required
          error={formState.errors.confirmPassword?.message}
          {...register("confirmPassword", { validate: (v) => v === watch("newPassword") || "As senhas não coincidem." })}
        />

        <Button type="submit" className="w-full" loading={resetPassword.isPending}>
          Redefinir senha
        </Button>
        <Link to="/login" className="block text-center text-sm text-slate-500 hover:underline">
          Voltar para o login
        </Link>
      </form>
    </AuthLayout>
  );
}
