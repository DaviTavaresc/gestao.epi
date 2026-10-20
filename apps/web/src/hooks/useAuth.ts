import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/authStore";

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const res = await api.post("/auth/login", data);
      return res.data;
    },
    onSuccess: (data) => {
      setSession(data);
      navigate("/");
    },
  });
}

export function useRegisterOrganization() {
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async (data: {
      organization: { razaoSocial: string; cnpj: string; nomeFantasia?: string; telefone?: string; email?: string };
      admin: { name: string; email: string; password: string };
    }) => {
      const res = await api.post("/auth/register", data);
      return res.data;
    },
    onSuccess: (data) => {
      setSession(data);
      navigate("/");
    },
  });
}

export function useLogout() {
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async () => api.post("/auth/logout"),
    onSettled: () => {
      clearSession();
      navigate("/login");
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => (await api.post("/auth/forgot-password", { email })).data,
  });
}

export function useResetPassword() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (data: { token: string; newPassword: string }) => (await api.post("/auth/reset-password", data)).data,
    onSuccess: () => navigate("/login"),
  });
}
