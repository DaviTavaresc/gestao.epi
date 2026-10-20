import { useAuthStore, Role } from "../stores/authStore";

export function usePermissions() {
  const role = useAuthStore((s) => s.user?.role);

  function canWrite(allowedRoles: Role[]): boolean {
    if (!role) return false;
    if (role === "ADMIN") return true;
    if (role === "CONSULTA") return false;
    return allowedRoles.includes(role);
  }

  return { role, isAdmin: role === "ADMIN", canWrite };
}
