import { ClipboardList, LayoutDashboard, Package, Plug, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: "/" | "/clientes" | "/produtos" | "/pedidos" | "/integracao";
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  heading?: string;
  items: NavItem[];
}

/** Slice 1 navigation. Visibility here is convenience only: the server enforces access. */
export const navSections: NavSection[] = [
  {
    items: [
      { to: "/", label: "Início", icon: LayoutDashboard },
      { to: "/clientes", label: "Clientes", icon: Users },
      { to: "/produtos", label: "Produtos", icon: Package },
      { to: "/pedidos", label: "Pedidos", icon: ClipboardList },
    ],
  },
  {
    heading: "Sistema",
    items: [{ to: "/integracao", label: "Integração", icon: Plug }],
  },
];
