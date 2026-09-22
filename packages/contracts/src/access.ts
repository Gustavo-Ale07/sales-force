import type { AccountRole } from './auth.js';

/**
 * Roles that may see the integration with the ERP (status, mirror detail, worker mode). Single source
 * for the server policy (`getConfiguration`, and the detail of `/ready`) and for the web menu, so the
 * two cannot drift. It is only a convenience for the client: the server is what enforces it
 * (project-spec 8.2: "Usuários, integrações, configurações: Admin").
 */
export const INTEGRATION_ROLES: readonly AccountRole[] = Object.freeze<AccountRole[]>(['admin']);

export function canSeeIntegration(role: string): boolean {
  return (INTEGRATION_ROLES as readonly string[]).includes(role);
}
