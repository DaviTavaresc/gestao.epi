import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { api } from "./lib/api";
import { useAuthStore } from "./stores/authStore";
import { ProtectedRoute, AdminRoute } from "./routes/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { ToastHost } from "./components/ui/ToastHost";

import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";

import DashboardPage from "./pages/DashboardPage";
import EmployeesListPage from "./pages/employees/EmployeesListPage";
import EmployeeDetailPage from "./pages/employees/EmployeeDetailPage";
import BranchesPage from "./pages/branches/BranchesPage";
import PositionsPage from "./pages/positions/PositionsPage";
import DepartmentsPage from "./pages/departments/DepartmentsPage";
import PpeItemsPage from "./pages/ppe/PpeItemsPage";
import PpeCategoriesPage from "./pages/ppe/PpeCategoriesPage";
import PpeKitsPage from "./pages/ppe/PpeKitsPage";
import PositionMatrixPage from "./pages/ppe/PositionMatrixPage";
import StockCurrentPage from "./pages/stock/StockCurrentPage";
import StockMovementsPage from "./pages/stock/StockMovementsPage";
import SuppliersPage from "./pages/purchases/SuppliersPage";
import PurchasesListPage from "./pages/purchases/PurchasesListPage";
import PurchaseDetailPage from "./pages/purchases/PurchaseDetailPage";
import DeliveriesListPage from "./pages/deliveries/DeliveriesListPage";
import NewDeliveryPage from "./pages/deliveries/NewDeliveryPage";
import DeliveryDetailPage from "./pages/deliveries/DeliveryDetailPage";
import ReturnsPage from "./pages/returns/ReturnsPage";
import ChargesPage from "./pages/charges/ChargesPage";
import TrocasPage from "./pages/trocas/TrocasPage";
import CalendarPage from "./pages/calendar/CalendarPage";
import AlertsPage from "./pages/alerts/AlertsPage";
import ReportsPage from "./pages/reports/ReportsPage";
import CostsPage from "./pages/reports/CostsPage";
import UsersPage from "./pages/admin/UsersPage";
import AuditLogsPage from "./pages/admin/AuditLogsPage";
import SettingsPage from "./pages/admin/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";

let bootstrapStarted = false;

export default function App() {
  const setSession = useAuthStore((s) => s.setSession);
  const setStatus = useAuthStore((s) => s.setStatus);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status !== "idle") return;
    // Evita disparo duplicado em desenvolvimento (React StrictMode monta o efeito duas vezes
    // antes que a mudança de status para "loading" seja refletida na segunda invocação).
    if (bootstrapStarted) return;
    bootstrapStarted = true;
    setStatus("loading");
    (async () => {
      try {
        const refresh = await api.post("/auth/refresh");
        useAuthStore.getState().setAccessToken(refresh.data.accessToken);
        const me = await api.get("/auth/me");
        setSession({ accessToken: refresh.data.accessToken, user: me.data.user, organization: me.data.organization });
      } catch {
        setStatus("unauthenticated");
      }
    })();
  }, [status, setSession, setStatus]);

  return (
    <>
      <ToastHost />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registrar" element={<RegisterPage />} />
        <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />

            <Route path="/colaboradores" element={<EmployeesListPage />} />
            <Route path="/colaboradores/:id" element={<EmployeeDetailPage />} />
            <Route path="/filiais" element={<BranchesPage />} />
            <Route path="/cargos" element={<PositionsPage />} />
            <Route path="/setores" element={<DepartmentsPage />} />

            <Route path="/epis" element={<PpeItemsPage />} />
            <Route path="/epis/categorias" element={<PpeCategoriesPage />} />
            <Route path="/epis/kits" element={<PpeKitsPage />} />
            <Route path="/epis/matriz" element={<PositionMatrixPage />} />

            <Route path="/estoque" element={<StockCurrentPage />} />
            <Route path="/estoque/movimentacoes" element={<StockMovementsPage />} />

            <Route path="/entregas" element={<DeliveriesListPage />} />
            <Route path="/entregas/nova" element={<NewDeliveryPage />} />
            <Route path="/entregas/:id" element={<DeliveryDetailPage />} />
            <Route path="/devolucoes" element={<ReturnsPage />} />
            <Route path="/cobrancas" element={<ChargesPage />} />
            <Route path="/trocas" element={<TrocasPage />} />

            <Route path="/compras" element={<PurchasesListPage />} />
            <Route path="/compras/:id" element={<PurchaseDetailPage />} />
            <Route path="/fornecedores" element={<SuppliersPage />} />

            <Route path="/calendario" element={<CalendarPage />} />
            <Route path="/alertas" element={<AlertsPage />} />

            <Route path="/relatorios" element={<ReportsPage />} />
            <Route path="/relatorios/custos" element={<CostsPage />} />

            <Route element={<AdminRoute />}>
              <Route path="/admin/usuarios" element={<UsersPage />} />
              <Route path="/admin/auditoria" element={<AuditLogsPage />} />
              <Route path="/admin/configuracoes" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
