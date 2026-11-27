import { canAdministerDiscountLimits, canDecideApprovals, canSeeIntegration, canUseCommercial } from "@salesforce/contracts";
import { isOperationsRole, OPERATIONS_HOME } from "../lib/operations-role";
import { Bell, CalendarCheck, Hourglass, House, Package, Percent, Plug, Settings, ShieldCheck, ShoppingCart, SlidersHorizontal, UserRound, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: "/" | "/clientes" | "/produtos" | "/pedidos" | "/integracao" | "/configuracoes" | "/aprovacoes" | "/aguardando-liberacao" | "/tarefas" | "/notificacoes";
  label: string;
  icon: LucideIcon;
  /** Only the technical profile, whose top bar is the integration area (the administrator reaches it from the avatar menu). */
  integrationOnly?: boolean;
  /** Only who decides discount approvals (manager, admin), W-20. */
  approverOnly?: boolean;
  /** Only when the API lets the caller see at least one release-queue sector (the count endpoint answered). */
  releaseQueueOnly?: boolean;
}

/**
 * Top bar: the daily work areas only (Início, Clientes, Vendas, Catálogo, Tarefas, Notificações) plus the two queues
 * that carry a counter for who may see them. Configuration lives in the avatar menu (`menuItemsFor`). Labels follow the
 * legacy system's vocabulary so a seller used to it finds each area without relearning; the routes are unchanged.
 */
const allNavItems: NavItem[] = [
  { to: "/", label: "Início", icon: House },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/pedidos", label: "Vendas", icon: ShoppingCart },
  { to: "/produtos", label: "Catálogo", icon: Package },
  { to: "/tarefas", label: "Tarefas", icon: CalendarCheck },
  { to: "/notificacoes", label: "Notificações", icon: Bell },
  { to: "/aguardando-liberacao", label: "Aguardando liberação", icon: Hourglass, releaseQueueOnly: true },
  { to: "/aprovacoes", label: "Aprovações", icon: ShieldCheck, approverOnly: true },
  { to: "/integracao", label: "Integração", icon: Plug, integrationOnly: true },
  { to: "/configuracoes", label: "Configurações", icon: Settings, integrationOnly: true },
];

/**
 * Top-bar navigation for a role. The commercial areas are not for the technical profile (ROLE-1): it sees the
 * integration area only. Visibility here is convenience only: the server enforces access.
 */
export function navItemsFor(role: string | undefined, approvals = false, releaseQueue = false): NavItem[] {
  return allNavItems.filter((item) => {
    if (isOperationsRole(role)) return item.to === OPERATIONS_HOME;
    if (item.releaseQueueOnly) return releaseQueue && role !== undefined && canUseCommercial(role);
    // D-M: in `erp` mode the release belongs to Sankhya; the approvals screen does not exist for the user.
    if (item.approverOnly && !approvals) return false;
    if (item.approverOnly) return role !== undefined && canDecideApprovals(role);
    if (item.integrationOnly) return role === "technical";
    return role === undefined || canUseCommercial(role);
  });
}

export interface MenuItem {
  to: "/perfil" | "/parametros" | "/limites-desconto" | "/integracao" | "/configuracoes";
  label: string;
  icon: LucideIcon;
}

/**
 * Avatar-menu entries between the user header and "Sair": Perfil for everyone, Parâmetros for manager and
 * administrator, and the administrator's discount limits, integration and settings. Convenience only.
 */
export function menuItemsFor(role: string | undefined, approvals = false): MenuItem[] {
  const items: MenuItem[] = [{ to: "/perfil", label: "Perfil", icon: UserRound }];
  if (role === undefined || isOperationsRole(role)) return items;
  if (role === "admin" || role === "manager") items.push({ to: "/parametros", label: "Parâmetros", icon: SlidersHorizontal });
  if (approvals && canAdministerDiscountLimits(role)) items.push({ to: "/limites-desconto", label: "Limites de desconto", icon: Percent });
  if (role === "admin" && canSeeIntegration(role)) {
    items.push({ to: "/integracao", label: "Integração", icon: Plug }, { to: "/configuracoes", label: "Configurações", icon: Settings });
  }
  return items;
}
