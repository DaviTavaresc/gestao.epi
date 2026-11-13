import { create } from "zustand";

export type Role = "ADMIN" | "RH" | "GERENTE" | "DIRETORIA" | "CONSULTA";

export type AuthUser = { id: string; name: string; email: string; role: Role };
export type AuthOrganization = { id: string; razaoSocial: string; nomeFantasia?: string | null; logoUrl?: string | null };

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  organization: AuthOrganization | null;
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  setSession: (data: { accessToken: string; user: AuthUser; organization: AuthOrganization }) => void;
  setAccessToken: (token: string) => void;
  clearSession: () => void;
  setStatus: (status: AuthState["status"]) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  organization: null,
  status: "idle",
  setSession: ({ accessToken, user, organization }) =>
    set({ accessToken, user, organization, status: "authenticated" }),
  setAccessToken: (token) => set({ accessToken: token }),
  clearSession: () => set({ accessToken: null, user: null, organization: null, status: "unauthenticated" }),
  setStatus: (status) => set({ status }),
}));

export function roleLabel(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "Administrador";
    case "RH":
      return "RH";
    case "GERENTE":
      // Nome novo do perfil, pedido pelo RH. O valor gravado continua GERENTE:
      // o que muda e o rotulo que todo mundo le na tela.
      return "Adm. Operacional";
    case "DIRETORIA":
      return "Diretoria";
    case "CONSULTA":
      return "Consulta";
  }
}
