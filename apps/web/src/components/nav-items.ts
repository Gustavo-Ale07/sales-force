import { canSeeIntegration } from "@salesforce/contracts";
import { ClipboardList, LayoutDashboard, Package, Plug, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: "/" | "/clientes" | "/produtos" | "/pedidos" | "/integracao";
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  heading?: string;
  /** Only for the roles that may see the integration (INTEGRATION_ROLES). */
  integrationOnly?: boolean;
  items: NavItem[];
}

const allNavSections: NavSection[] = [
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
    integrationOnly: true,
    items: [{ to: "/integracao", label: "Integração", icon: Plug }],
  },
];

/**
 * Navigation for a role. Integração is only for who may see it; with no role (the dev design page) it is
 * left out. Visibility here is convenience only: the server enforces access.
 */
export function navSectionsFor(role: string | undefined): NavSection[] {
  return allNavSections.filter((section) => !section.integrationOnly || (role !== undefined && canSeeIntegration(role)));
}
