import type { AccountRole, ScopeActor } from '@salesforce/domain';
import type { CurrentUser } from './current-user.js';

/**
 * Central authorization policy (AUTH-4 is PROPOSED; this is the minimal, replaceable shape the
 * contracts and schema already express). Pure: no framework, no I/O.
 *
 * Two questions are answered here and nowhere else:
 *   - channel: may this role use this client at all? (AUTH-3; the external representative is
 *     mobile-only. That role does not exist in the contracts or schema yet, so today every role
 *     may use the web; an unknown role has no channel and is denied everywhere - fail closed.)
 *   - route: which roles may call an operation of the route registry? An operation without an
 *     entry is denied for everyone (default deny): granting access is always an explicit line.
 *
 * Data scope (which rows) is not decided here: it delegates to `resolveCustomerScope` in
 * `@salesforce/domain` (see `PolicyService.customerScope`).
 */

export type Channel = 'web' | 'mobile';
export const CHANNELS: readonly Channel[] = ['web', 'mobile'];

export const ROLE_CHANNELS: Readonly<Record<AccountRole, readonly Channel[]>> = {
  admin: ['web', 'mobile'],
  manager: ['web', 'mobile'],
  seller: ['web', 'mobile'],
};

export interface RoutePolicy {
  readonly roles: readonly AccountRole[];
}

const EVERY_ROLE: readonly AccountRole[] = ['admin', 'manager', 'seller'];

/**
 * Explicit grants by `operationId`. Endpoints of later stages are added here together with their
 * matrix test row (`test/integration/authorization-matrix.test.ts` fails when a session route of the
 * registry has no row).
 */
export const ROUTE_POLICY: Readonly<Record<string, RoutePolicy>> = {
  // Any authenticated account may end its own session.
  logout: { roles: EVERY_ROLE },
  // "Usuários, integrações, configurações: Admin" (project-spec 8.2, default matrix). ASSUMPTION:
  // the contract lists 403 for this route but names no role; admin-only is the least privilege.
  getConfiguration: { roles: ['admin'] },
  // Commercial routes (Stage 3A). Each is open to the three roles the schema has; WHICH rows a
  // caller sees is the data scope (`resolveCustomerScope`), never this table. An external
  // representative role does not exist yet (AUTH-3 PROPOSED): when it does it gets no line here
  // until the owner grants it. ASSUMPTION: a seller may create/replace/discard their own drafts, and a
  // manager or admin (whose customer scope is every customer) may create/replace/discard ANY seller's
  // drafts. The second half is not written down anywhere: it follows from the scope rule and stays
  // pending owner ruling R35/R36 (who may act on behalf of whom).
  getDashboard: { roles: EVERY_ROLE },
  listSellers: { roles: EVERY_ROLE },
  listCustomers: { roles: EVERY_ROLE },
  getCustomer: { roles: EVERY_ROLE },
  listProductGroups: { roles: EVERY_ROLE },
  listProducts: { roles: EVERY_ROLE },
  getProduct: { roles: EVERY_ROLE },
  listOrders: { roles: EVERY_ROLE },
  createOrder: { roles: EVERY_ROLE },
  getOrder: { roles: EVERY_ROLE },
  replaceOrder: { roles: EVERY_ROLE },
  discardOrder: { roles: EVERY_ROLE },
  submitOrder: { roles: EVERY_ROLE },
};

export type PolicyDenial = 'channel_not_permitted' | 'no_policy' | 'role_not_permitted';
export type PolicyDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: PolicyDenial };

export function isChannelAllowed(role: string, channel: Channel): boolean {
  // Own keys only: `constructor`, `__proto__` and friends are not roles.
  if (!Object.hasOwn(ROLE_CHANNELS, role)) return false;
  return (ROLE_CHANNELS as Readonly<Record<string, readonly Channel[]>>)[role]?.includes(channel) ?? false;
}

export function authorizeRoute(
  actor: { readonly role: string; readonly channel: Channel },
  operationId: string,
  policy: Readonly<Record<string, RoutePolicy>> = ROUTE_POLICY,
): PolicyDecision {
  if (!isChannelAllowed(actor.role, actor.channel)) return { allowed: false, reason: 'channel_not_permitted' };
  const entry = Object.hasOwn(policy, operationId) ? policy[operationId] : undefined;
  if (entry === undefined) return { allowed: false, reason: 'no_policy' };
  return (entry.roles as readonly string[]).includes(actor.role)
    ? { allowed: true }
    : { allowed: false, reason: 'role_not_permitted' };
}

/** The identity module's view of an account, in the shape the domain scope rules expect. */
export function toScopeActor(user: Pick<CurrentUser, 'role' | 'email' | 'sellerCodes'>): ScopeActor {
  return { role: user.role, accountEmail: user.email, linkedSellerCodes: user.sellerCodes };
}
