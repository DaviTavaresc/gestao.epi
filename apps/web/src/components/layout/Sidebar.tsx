import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { ShieldHalf, X } from "lucide-react";
import { navGroups } from "./navConfig";
import { usePermissions } from "../../hooks/usePermissions";
import { useAuthStore } from "../../stores/authStore";

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { isAdmin } = usePermissions();
  const organization = useAuthStore((s) => s.organization);

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-900 text-navy-100 transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-navy-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <ShieldHalf className="h-6 w-6 text-navy-300" />
            <div>
              <p className="text-sm font-semibold text-white">Gestão de EPI</p>
              <p className="truncate text-xs text-navy-300">{organization?.nomeFantasia || organization?.razaoSocial}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-navy-300 hover:bg-navy-800 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navGroups
            .filter((g) => !g.adminOnly || isAdmin)
            .map((group) => (
              <div key={group.title || "root"} className="mb-4">
                {group.title && (
                  <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-navy-400">{group.title}</p>
                )}
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onClose}
                    className={({ isActive }) =>
                      clsx(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive ? "bg-navy-700 text-white" : "text-navy-200 hover:bg-navy-800 hover:text-white"
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
        </nav>
      </aside>
    </>
  );
}
