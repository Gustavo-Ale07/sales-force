import { normalizeEmail, type InstallationConfiguration } from './configuration.js';
import type { AccountRole, Customer } from './entities.js';

/** Who is asking. `linkedSellerCodes` are the account-to-seller links held by the identity module. */
export interface ScopeActor {
  readonly role: AccountRole;
  readonly accountEmail: string;
  readonly linkedSellerCodes: readonly number[];
}

/** Customer visibility scope, suitable for pushing down into a query as well as for row checks. */
export type CustomerScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'sellers'; readonly sellerCodes: readonly number[] };

/** Why a scope could not be granted. `no_seller_scope`: a seller without a valid seller link. */
export type CustomerScopeDenial = 'no_seller_scope' | 'role_not_permitted';

export type CustomerScopeOutcome =
  | { readonly ok: true; readonly scope: CustomerScope }
  | { readonly ok: false; readonly reason: CustomerScopeDenial };

/** A seller code is a Sankhya CODVEND: a safe integer >= 1 (0/negative/NaN/fractions are not sellers). */
export function isValidSellerCode(code: unknown): code is number {
  return typeof code === 'number' && Number.isSafeInteger(code) && code >= 1;
}

/**
 * Portfolio scope outcome (P-21; enforced server-side, never by UI filtering). The role check is an
 * allow-list: admin/manager see everything; a seller needs at least one VALID seller link (code >= 1)
 * from the source the strategy names, otherwise `no_seller_scope` (never 'all', whatever the
 * strategy, `all_visible` included); any other role is denied. Team trees are a later concern.
 * - `all_visible`: a linked seller (identity link or configuration link) sees every customer.
 * - `customer_seller_field`: customers whose seller is one of `actor.linkedSellerCodes`.
 * - `explicit_account_links`: customers whose seller is one of the sellers the configuration links
 *   to the account e-mail (`customers.accountSellerLinks`).
 */
export function resolveCustomerScopeOutcome(
  actor: ScopeActor,
  config: InstallationConfiguration,
): CustomerScopeOutcome {
  const role: string = actor.role;
  if (role === 'admin' || role === 'manager') return { ok: true, scope: { kind: 'all' } };
  if (role !== 'seller') return { ok: false, reason: 'role_not_permitted' };

  const strategy = config.customers.portfolioOwnership.strategy;
  const email = normalizeEmail(actor.accountEmail);
  const configured = config.customers.accountSellerLinks
    .filter((link) => normalizeEmail(link.accountEmail) === email)
    .map((link) => link.sellerCode);
  const identity = actor.linkedSellerCodes;

  const codes = unique(
    (strategy === 'customer_seller_field' ? identity : strategy === 'explicit_account_links' ? configured : [...identity, ...configured]).filter(
      isValidSellerCode,
    ),
  );
  if (codes.length === 0) return { ok: false, reason: 'no_seller_scope' };
  if (strategy === 'all_visible') return { ok: true, scope: { kind: 'all' } };
  return { ok: true, scope: { kind: 'sellers', sellerCodes: codes } };
}

/**
 * Scope for a row filter. Fail-closed: whenever the outcome is a denial the scope is a seller scope
 * with no sellers (sees nothing); callers that must report the denial use the outcome.
 */
export function resolveCustomerScope(
  actor: ScopeActor,
  config: InstallationConfiguration,
): CustomerScope {
  const outcome = resolveCustomerScopeOutcome(actor, config);
  return outcome.ok ? outcome.scope : { kind: 'sellers', sellerCodes: [] };
}

export function isCustomerInScope(customer: Pick<Customer, 'sellerCode'>, scope: CustomerScope): boolean {
  if (scope.kind === 'all') return true;
  return isValidSellerCode(customer.sellerCode) && scope.sellerCodes.includes(customer.sellerCode);
}

export function canActorSeeCustomer(
  actor: ScopeActor,
  customer: Pick<Customer, 'sellerCode'>,
  config: InstallationConfiguration,
): boolean {
  return isCustomerInScope(customer, resolveCustomerScope(actor, config));
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)];
}
