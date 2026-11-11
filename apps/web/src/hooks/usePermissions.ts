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

  // Administracao: filiais, configuracoes da empresa e acessos. O RH entra
  // junto com o administrador; o que ele nao alcanca e a conta de administrador,
  // regra conferida caso a caso (e repetida pela API).
  return { role, isAdmin: role === "ADMIN", isAdminOrRh: role === "ADMIN" || role === "RH", canWrite };
}
