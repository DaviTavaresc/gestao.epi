import { create } from "zustand";

export type Role = "ADMIN" | "ALMOXARIFADO" | "SEGURANCA_TRABALHO" | "CONSULTA";

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
    case "ALMOXARIFADO":
      return "Almoxarifado";
    case "SEGURANCA_TRABALHO":
      return "Segurança do Trabalho";
    case "CONSULTA":
      return "Consulta";
  }
}
