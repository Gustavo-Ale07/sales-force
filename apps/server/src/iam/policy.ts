import { COMMERCIAL_ROLES, INTEGRATION_ROLES } from '@salesforce/contracts';
import { ACCOUNT_ROLES, type AccountRole, type ScopeActor } from '@salesforce/domain';
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
  // ROLE-1: platform operation only; no mobile use is granted (deny by default).
  technical: ['web'],
};

export interface RoutePolicy {
  readonly roles: readonly AccountRole[];
}

/** The commercial profiles (ROLE-1: never `technical`). */
const EVERY_ROLE: readonly AccountRole[] = COMMERCIAL_ROLES;

/**
 * Explicit grants by `operationId`. Endpoints of later stages are added here together with their
 * matrix test row (`test/integration/authorization-matrix.test.ts` fails when a session route of the
 * registry has no row).
 */
export const ROUTE_POLICY: Readonly<Record<string, RoutePolicy>> = {
  // Any authenticated account may end its own session.
  logout: { roles: ACCOUNT_ROLES },
  // "Usuários, integrações, configurações: Admin" (project-spec 8.2) plus the `technical` profile (ROLE-1: integration
  // and sync status, technical configuration; this is the only route that exposes them). The detail of `/ready`
  // follows this same grant (health.controller.ts), so it is visible to admin and technical only; manager, seller
  // and anonymous callers get the coarse verdict. The least-privilege set (INTEGRATION_ROLES) is the rule.
  getConfiguration: { roles: INTEGRATION_ROLES },
  // Minimal order-entry slice (never syncStates/gateway/integration/customers/pricing/financial):
  // open to every role that can create an order (seller/manager/admin), unlike getConfiguration above.
  getOrderEntryConfiguration: { roles: EVERY_ROLE },
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
  // Same catalog read as getProduct (product visibility and seller scope are enforced by the handler).
  getProductImage: { roles: EVERY_ROLE },
  // ASSUMPTION (pending owner confirmation): resolving pasted/imported product identifiers is a read of the
  // same catalog as listProducts, so it is open to every role; the customer scope still applies to prices.
  resolveProducts: { roles: EVERY_ROLE },
  listOrders: { roles: EVERY_ROLE },
  createOrder: { roles: EVERY_ROLE },
  getOrder: { roles: EVERY_ROLE },
  replaceOrder: { roles: EVERY_ROLE },
  discardOrder: { roles: EVERY_ROLE },
  submitOrder: { roles: EVERY_ROLE },
  // "Repetir último pedido" (Phase C): a draft-creation route from the customer's own order history in
  // Sales Force, so it follows the same grant as createOrder.
  repeatLastOrder: { roles: EVERY_ROLE },
  // Recurring order templates (Phase E). Reads follow the customer read grant and writes follow the
  // order-draft grant: every role that exists, never more than the order routes give. WHICH customers a
  // caller reaches is the seller scope of the customer (404 outside it), never this table. ASSUMPTION
  // (owner ruling, PLAN): any actor in the customer scope may read, use, edit and delete a template.
  listOrderTemplates: { roles: EVERY_ROLE },
  createOrderTemplate: { roles: EVERY_ROLE },
  getOrderTemplate: { roles: EVERY_ROLE },
  replaceOrderTemplate: { roles: EVERY_ROLE },
  deleteOrderTemplate: { roles: EVERY_ROLE },
  useOrderTemplate: { roles: EVERY_ROLE },
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
export function toScopeActor(user: Pick<CurrentUser, 'role' | 'username' | 'sellerCodes'>): ScopeActor {
  // The domain scope rules still call the login identifier `accountEmail`.
  return { role: user.role, accountEmail: user.username, linkedSellerCodes: user.sellerCodes };
}
