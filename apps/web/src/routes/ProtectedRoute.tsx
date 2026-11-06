import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore, Role } from "../stores/authStore";
import { Spinner } from "../components/ui/Feedback";

export function ProtectedRoute() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === "idle" || status === "loading") return <Spinner label="Carregando sessão..." />;
  if (status === "unauthenticated") return <Navigate to="/login" state={{ from: location }} replace />;

  return <Outlet />;
}

export function AdminRoute() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== "ADMIN") return <Navigate to="/" replace />;
  return <Outlet />;
}

// Área aberta a alguns perfis além do administrador, que entra em todas. O
// backend repete a mesma regra: aqui é só para não mostrar tela que daria 403.
export function RoleRoute({ roles }: { roles: Role[] }) {
  const role = useAuthStore((s) => s.user?.role);
  if (!role || (role !== "ADMIN" && !roles.includes(role))) return <Navigate to="/" replace />;
  return <Outlet />;
}
