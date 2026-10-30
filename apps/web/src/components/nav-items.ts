import { canAdministerDiscountLimits, canDecideApprovals, canSeeIntegration, canUseCommercial } from "@salesforce/contracts";
import { List, Percent, ShieldCheck, Plug, ShoppingCart, Target, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: "/" | "/clientes" | "/produtos" | "/pedidos" | "/integracao" | "/limites-desconto" | "/aprovacoes";
  label: string;
  icon: LucideIcon;
  /** Only for the roles that may see the integration (INTEGRATION_ROLES). */
  integrationOnly?: boolean;
  /** Only the administrator (discount limits, W-39). */
  adminOnly?: boolean;
  /** Only who decides discount approvals (manager, admin), W-20. */
  approverOnly?: boolean;
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
  { to: "/aprovacoes", label: "Aprovações", icon: ShieldCheck, approverOnly: true },
  { to: "/limites-desconto", label: "Limites de desconto", icon: Percent, adminOnly: true },
  { to: "/integracao", label: "Integração", icon: Plug, integrationOnly: true },
];

/**
 * Navigation for a role. Integração is only for who may see it; with no role (the dev design page) it is
 * left out. The commercial areas are not for the technical profile (ROLE-1): it sees Integração only. Visibility
 * here is convenience only: the server enforces access.
 */
export function navItemsFor(role: string | undefined, approvals = false): NavItem[] {
  return allNavItems.filter((item) => {
    // D-M: in `erp` mode the release belongs to Sankhya; the limits and approvals screens do not exist for the user.
    if ((item.approverOnly || item.adminOnly) && !approvals) return false;
    if (item.approverOnly) return role !== undefined && canDecideApprovals(role);
    if (item.adminOnly) return role !== undefined && canAdministerDiscountLimits(role);
    return item.integrationOnly ? role !== undefined && canSeeIntegration(role) : role === undefined || canUseCommercial(role);
  });
}
