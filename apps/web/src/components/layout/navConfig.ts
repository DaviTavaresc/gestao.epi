import {
  LayoutDashboard,
  Users,
  Briefcase,
  Building2,
  Landmark,
  HardHat,
  Tags,
  PackageOpen,
  Table2,
  Boxes,
  ArrowLeftRight,
  Truck,
  RotateCcw,
  Repeat,
  HandCoins,
  ShoppingCart,
  Factory,
  CalendarDays,
  BellRing,
  FileBarChart,
  DollarSign,
  ShieldCheck,
  History,
  Settings,
  LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; to: string; icon: LucideIcon };
export type NavGroup = { title: string; items: NavItem[]; adminOnly?: boolean };

export const navGroups: NavGroup[] = [
  {
    title: "",
    items: [{ label: "Dashboard", to: "/", icon: LayoutDashboard }],
  },
  {
    title: "Gestão",
    items: [
      { label: "Colaboradores", to: "/colaboradores", icon: Users },
      { label: "Filiais", to: "/filiais", icon: Landmark },
      { label: "Cargos", to: "/cargos", icon: Briefcase },
      { label: "Setores", to: "/setores", icon: Building2 },
    ],
  },
  {
    title: "EPIs",
    items: [
      { label: "EPIs", to: "/epis", icon: HardHat },
      { label: "Categorias", to: "/epis/categorias", icon: Tags },
      { label: "Kits", to: "/epis/kits", icon: PackageOpen },
      { label: "Matriz Cargo x EPI", to: "/epis/matriz", icon: Table2 },
    ],
  },
  {
    title: "Estoque",
    items: [
      { label: "Estoque atual", to: "/estoque", icon: Boxes },
      { label: "Movimentações", to: "/estoque/movimentacoes", icon: ArrowLeftRight },
    ],
  },
  {
    title: "Operações",
    items: [
      { label: "Entregas", to: "/entregas", icon: Truck },
      { label: "Devoluções", to: "/devolucoes", icon: RotateCcw },
      { label: "Trocas", to: "/trocas", icon: Repeat },
      { label: "Cobranças", to: "/cobrancas", icon: HandCoins },
    ],
  },
  {
    title: "Compras",
    items: [
      { label: "Compras", to: "/compras", icon: ShoppingCart },
      { label: "Fornecedores", to: "/fornecedores", icon: Factory },
    ],
  },
  {
    title: "Controle",
    items: [
      { label: "Calendário", to: "/calendario", icon: CalendarDays },
      { label: "Alertas", to: "/alertas", icon: BellRing },
    ],
  },
  {
    title: "Relatórios",
    items: [
      { label: "Relatórios", to: "/relatorios", icon: FileBarChart },
      { label: "Custos", to: "/relatorios/custos", icon: DollarSign },
    ],
  },
  {
    title: "Administração",
    adminOnly: true,
    items: [
      { label: "Usuários", to: "/admin/usuarios", icon: ShieldCheck },
      { label: "Auditoria", to: "/admin/auditoria", icon: History },
      { label: "Configurações", to: "/admin/configuracoes", icon: Settings },
    ],
  },
];
