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

/**
 * Portfolio scope (P-21; enforced server-side, never by UI filtering).
 * - `all_visible`: everyone sees every customer.
 * - `customer_seller_field`: a seller sees customers whose seller field is one of the seller codes
 *   linked to the account by the identity module (`actor.linkedSellerCodes`).
 * - `explicit_account_links`: a seller sees customers whose seller is one of the sellers the
 *   configuration links to the account e-mail (`customers.accountSellerLinks`).
 * `manager` and `admin` see everything (team trees are a later concern). A seller without any
 * link sees nothing.
 */
export function resolveCustomerScope(
  actor: ScopeActor,
  config: InstallationConfiguration,
): CustomerScope {
  if (actor.role !== 'seller') return { kind: 'all' };

  const strategy = config.customers.portfolioOwnership.strategy;
  if (strategy === 'all_visible') return { kind: 'all' };

  if (strategy === 'customer_seller_field') {
    return { kind: 'sellers', sellerCodes: unique(actor.linkedSellerCodes) };
  }

  const email = normalizeEmail(actor.accountEmail);
  const codes = config.customers.accountSellerLinks
    .filter((link) => normalizeEmail(link.accountEmail) === email)
    .map((link) => link.sellerCode);
  return { kind: 'sellers', sellerCodes: unique(codes) };
}

export function isCustomerInScope(customer: Pick<Customer, 'sellerCode'>, scope: CustomerScope): boolean {
  if (scope.kind === 'all') return true;
  return customer.sellerCode !== null && scope.sellerCodes.includes(customer.sellerCode);
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
