import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
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
