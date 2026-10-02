import type { AccountRole } from './auth.js';

/**
 * Roles that may see the integration with the ERP (status, mirror detail, worker mode). Single source
 * for the server policy (`getConfiguration`, and the detail of `/ready`) and for the web menu, so the
 * two cannot drift. It is only a convenience for the client: the server is what enforces it
 * (project-spec 8.2: "Usuários, integrações, configurações: Admin"; ROLE-1: the `technical` profile
 * also reads health, diagnostics, integration and sync status).
 */
export const INTEGRATION_ROLES: readonly AccountRole[] = Object.freeze<AccountRole[]>(['admin', 'technical']);

export function canSeeIntegration(role: string): boolean {
  return (INTEGRATION_ROLES as readonly string[]).includes(role);
}

/**
 * Roles that work with the commercial areas (catalog, customers, orders, dashboard). `technical`
 * (ROLE-1) is deliberately absent: no portfolio, no commercial changes. Convenience for the client
 * (menu, route guard); the server policy is what enforces it.
 */
export const COMMERCIAL_ROLES: readonly AccountRole[] = Object.freeze<AccountRole[]>(['admin', 'manager', 'seller']);

export function canUseCommercial(role: string): boolean {
  return (COMMERCIAL_ROLES as readonly string[]).includes(role);
}
