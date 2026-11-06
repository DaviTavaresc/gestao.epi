import { useAuthStore, Role } from "../stores/authStore";

export function usePermissions() {
  const role = useAuthStore((s) => s.user?.role);

  function canWrite(allowedRoles: Role[]): boolean {
    if (!role) return false;
    if (role === "ADMIN") return true;
    // Diretoria e consulta acompanham, mas nao escrevem em nenhum modulo.
    if (role === "DIRETORIA" || role === "CONSULTA") return false;
    return allowedRoles.includes(role);
  }

  return { role, isAdmin: role === "ADMIN", canWrite };
}
