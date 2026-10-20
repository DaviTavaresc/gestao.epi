import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Branch } from "../types";
import { useAuthStore } from "../stores/authStore";

// Filiais visíveis ao usuário (o backend já restringe quem tem filial fixa).
export function useBranches(onlyActive = true) {
  return useQuery<Branch[]>({
    queryKey: ["branches", onlyActive],
    queryFn: async () => (await api.get("/branches", { params: onlyActive ? { status: "ATIVO" } : {} })).data,
    staleTime: 5 * 60 * 1000,
  });
}

// true quando o usuário pode alternar entre filiais (admin ou perfil corporativo).
export function useCanSwitchBranch(): boolean {
  const user = useAuthStore((s) => s.user);
  const { data } = useBranches();
  if (!user) return false;
  return (data?.length ?? 0) > 1;
}
