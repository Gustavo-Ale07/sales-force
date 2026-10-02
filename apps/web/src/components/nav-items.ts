import { canSeeIntegration, canUseCommercial } from "@salesforce/contracts";
import { List, Plug, ShoppingCart, Target, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: "/" | "/clientes" | "/produtos" | "/pedidos" | "/integracao";
  label: string;
  icon: LucideIcon;
  /** Only for the roles that may see the integration (INTEGRATION_ROLES). */
  integrationOnly?: boolean;
}

/**
 * Main navigation, in the Vidya Force order (Início, Catálogo, Clientes, Vendas). Labels follow the legacy
 * system's vocabulary so a seller used to it finds each area without relearning (the PLAC reference kit names
 * the first one "Início"); the routes are unchanged.
 * Integração is not part of Vidya: it stays as a trailing item that only the integration roles see.
 */
const allNavItems: NavItem[] = [
  { to: "/", label: "Início", icon: Target },
  { to: "/produtos", label: "Catálogo", icon: List },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/pedidos", label: "Vendas", icon: ShoppingCart },
  { to: "/integracao", label: "Integração", icon: Plug, integrationOnly: true },
];

/**
 * Navigation for a role. Integração is only for who may see it; with no role (the dev design page) it is
 * left out. The commercial areas are not for the technical profile (ROLE-1): it sees Integração only. Visibility
 * here is convenience only: the server enforces access.
 */
export function navItemsFor(role: string | undefined): NavItem[] {
  return allNavItems.filter((item) =>
    item.integrationOnly ? role !== undefined && canSeeIntegration(role) : role === undefined || canUseCommercial(role),
  );
}
