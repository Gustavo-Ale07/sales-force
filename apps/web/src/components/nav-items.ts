import { canAdministerDiscountLimits, canDecideApprovals, canSeeIntegration, canUseCommercial } from "@salesforce/contracts";
import { isOperationsRole, OPERATIONS_HOME } from "../lib/operations-role";
import { Bell, CalendarCheck, Hourglass, House, Package, Percent, Plug, Settings, ShieldCheck, ShoppingCart, SlidersHorizontal, Smartphone, Target, UserRound, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: "/" | "/perfil" | "/clientes" | "/produtos" | "/pedidos" | "/integracao" | "/configuracoes" | "/limites-desconto" | "/parametros" | "/descontos-representante" | "/aparelhos" | "/aprovacoes" | "/aguardando-liberacao" | "/tarefas" | "/notificacoes" | "/metas";
  label: string;
  icon: LucideIcon;
  /** Only for the roles that may see the integration (INTEGRATION_ROLES). */
  integrationOnly?: boolean;
  /** Only the administrator (discount limits, W-39). */
  adminOnly?: boolean;
  /** Only who decides discount approvals (manager, admin), W-20. */
  approverOnly?: boolean;
  /** Only when the API lets the caller see at least one release-queue sector (the count endpoint answered). */
  releaseQueueOnly?: boolean;
  /** Who manages devices (admin, manager), W-36. Independent of the ERP mode. */
  devicesOnly?: boolean;
}

/**
 * Main navigation, in the app order (Início, Clientes, Vendas, Catálogo, Perfil); the site adds the management items after it. Labels follow the legacy
 * system's vocabulary so a seller used to it finds each area without relearning (the PLAC reference kit names
 * the first one "Início"); the routes are unchanged.
 * Integração is not part of Vidya: it stays as a trailing item that only the integration roles see.
 */
const allNavItems: NavItem[] = [
  { to: "/", label: "Início", icon: House },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/pedidos", label: "Vendas", icon: ShoppingCart },
  { to: "/produtos", label: "Catálogo", icon: Package },
  { to: "/perfil", label: "Perfil", icon: UserRound },
  { to: "/tarefas", label: "Tarefas", icon: CalendarCheck },
  { to: "/notificacoes", label: "Notificações", icon: Bell },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/aguardando-liberacao", label: "Aguardando liberação", icon: Hourglass, releaseQueueOnly: true },
  { to: "/aprovacoes", label: "Aprovações", icon: ShieldCheck, approverOnly: true },
  { to: "/limites-desconto", label: "Limites de desconto", icon: Percent, adminOnly: true },
  { to: "/descontos-representante", label: "Descontos por representante", icon: Percent, devicesOnly: true },
  { to: "/parametros", label: "Parâmetros", icon: SlidersHorizontal, devicesOnly: true },
  { to: "/aparelhos", label: "Aparelhos", icon: Smartphone, devicesOnly: true },
  { to: "/integracao", label: "Integração", icon: Plug, integrationOnly: true },
  { to: "/configuracoes", label: "Configurações", icon: Settings, integrationOnly: true },
];

/**
 * Navigation for a role. Integração is only for who may see it; with no role (the dev design page) it is
 * left out. The commercial areas are not for the technical profile (ROLE-1): it sees Integração only. Visibility
 * here is convenience only: the server enforces access.
 */
export function navItemsFor(role: string | undefined, approvals = false, releaseQueue = false): NavItem[] {
  return allNavItems.filter((item) => {
    if (isOperationsRole(role)) return item.to === OPERATIONS_HOME;
    if (item.devicesOnly) return role !== undefined && (role === "admin" || role === "manager");
    if (item.releaseQueueOnly) return releaseQueue && role !== undefined && canUseCommercial(role);
    // D-M: in `erp` mode the release belongs to Sankhya; the limits and approvals screens do not exist for the user.
    if ((item.approverOnly || item.adminOnly) && !approvals) return false;
    if (item.approverOnly) return role !== undefined && canDecideApprovals(role);
    if (item.adminOnly) return role !== undefined && canAdministerDiscountLimits(role);
    return item.integrationOnly ? role !== undefined && canSeeIntegration(role) : role === undefined || canUseCommercial(role);
  });
}
