import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, Bell, BellRing, LogOut, ChevronDown, User } from "lucide-react";
import { GlobalSearch } from "./GlobalSearch";
import { useAuthStore, roleLabel } from "../../stores/authStore";
import { useOpenAlertsCount, useUnreadNotificationsCount } from "../../hooks/useAlertsCount";
import { api } from "../../lib/api";
import { useLogout } from "../../hooks/useAuth";
import { Notification } from "../../types";

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const user = useAuthStore((s) => s.user);
  const { data: alertsCount } = useOpenAlertsCount();
  const { data: unreadCount } = useUnreadNotificationsCount();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const logout = useLogout();
  const queryClient = useQueryClient();

  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["notifications", "recent"],
    queryFn: async () => (await api.get("/notifications", { params: { pageSize: 8 } })).data.items,
    enabled: notifOpen,
  });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function markAsRead(id: string) {
    await api.patch(`/notifications/${id}/ler`);
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
      <div className="flex items-center gap-3">
        <button onClick={onMenuClick} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden">
          <Menu className="h-5 w-5" />
        </button>
        <div className="hidden md:block">
          <GlobalSearch />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/alertas"
          className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          title="Alertas"
        >
          <BellRing className="h-5 w-5" />
          {!!alertsCount && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {alertsCount > 99 ? "99+" : alertsCount}
            </span>
          )}
        </Link>

        <div ref={notifRef} className="relative">
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            title="Notificações"
          >
            <Bell className="h-5 w-5" />
            {!!unreadCount && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-navy-600 px-1 text-[10px] font-semibold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              <p className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Notificações</p>
              {!notifications?.length && <p className="px-4 py-6 text-center text-sm text-slate-400">Sem notificações.</p>}
              {notifications?.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markAsRead(n.id);
                    if (n.link) navigate(n.link);
                    setNotifOpen(false);
                  }}
                  className={`block w-full border-b border-slate-50 px-4 py-3 text-left text-sm hover:bg-slate-50 ${!n.read ? "bg-navy-50/40" : ""}`}
                >
                  <p className="font-medium text-slate-700">{n.title}</p>
                  <p className="text-xs text-slate-500">{n.message}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={userRef} className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-100 text-navy-700">
              <User className="h-4 w-4" />
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium text-slate-700">{user?.name}</p>
              <p className="text-xs text-slate-400">{user ? roleLabel(user.role) : ""}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <button
                onClick={() => logout.mutate()}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
