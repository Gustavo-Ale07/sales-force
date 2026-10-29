import {
  DISCOUNT_AUTHORITY_LEVELS,
  PROVISIONAL_DISCOUNT_AUTHORITY,
  type DiscountAuthorityConfiguration,
  type DiscountAuthorityLevel,
} from './configuration.js';
import type { AccountRole, OrderItem } from './entities.js';
import { compareDecimalStrings, isZeroDecimal, validateDiscountPercent, type DecimalString } from './money.js';

/**
 * Discount authority (P-10, DISC-2): the base is the customer's price-table price already resolved on the
 * order line (P-09); routing is seller -> manager -> director with limits taken from the installation
 * configuration (never literals). Pure and deterministic (P-14). It reads no cost and no margin and returns
 * none (P-20).
 *
 * Owner rulings (DISC-2..6, Q1-Q13): three inclusive limits; the director limit is the absolute ceiling (above it
 * nobody approves); absent configuration means the provisional 5/15/30. Still without a field: a named substitute
 * approver (the approver is a pool per level, DISC-4) and the credit-exception approver (R37).
 */

export type DiscountAuthorityRefusal =
  /** The line has no usable table price (missing is not zero; an explicit zero is no base either). */
  | 'price_base_missing'
  /** Limits absent, incomplete, malformed or not ascending. */
  | 'authority_not_configured'
  /** The actor's role is not part of the seller -> manager -> director chain. */
  | 'actor_out_of_chain'
  /** Above the director limit: the absolute ceiling (Q13); nobody approves, the draft stays saved as blocked. */
  | 'above_ceiling';

export type DiscountAuthorityDecision =
  | { readonly decision: 'within_authority' }
  /** The discount is valid but needs this level to approve; who holds the level is not resolved here. */
  | { readonly decision: 'needs_approval'; readonly level: Exclude<DiscountAuthorityLevel, 'seller'> }
  | { readonly decision: 'refused'; readonly reason: DiscountAuthorityRefusal };

export interface LineDiscountAuthority {
  readonly lineNo: number;
  readonly result: DiscountAuthorityDecision;
}

export type OrderDiscountAuthority = DiscountAuthorityDecision & { readonly lines: readonly LineDiscountAuthority[] };

const WITHIN: DiscountAuthorityDecision = { decision: 'within_authority' };
const refused = (reason: DiscountAuthorityRefusal): DiscountAuthorityDecision => ({ decision: 'refused', reason });

/** The authority level an account role holds, or `null` when the role is outside the chain. */
export function discountAuthorityLevelOf(role: AccountRole): DiscountAuthorityLevel | null {
  if (role === 'seller') return 'seller';
  if (role === 'manager') return 'manager';
  return null;
}

export interface ResolvedDiscountAuthority {
  readonly limits: Record<DiscountAuthorityLevel, DecimalString>;
  /** True while the values are the owner's provisional ones ("ajustar pelo dono"). */
  readonly provisional: boolean;
}

/**
 * The limits in force: the stored block, or the provisional 5/15/30 when none is stored (Q11); `null` when a stored
 * block cannot be trusted (any gap, malformed value or disorder): then every discount is refused.
 */
export function resolveDiscountAuthority(config: DiscountAuthorityConfiguration | undefined): ResolvedDiscountAuthority | null {
  const source = config ?? PROVISIONAL_DISCOUNT_AUTHORITY;
  const limits: Partial<Record<DiscountAuthorityLevel, DecimalString>> = {};
  let previous: DecimalString | null = null;
  for (const level of DISCOUNT_AUTHORITY_LEVELS) {
    const raw = source.limits[level];
    if (raw === null) return null;
    const parsed = validateDiscountPercent(raw);
    if (!parsed.ok) return null;
    if (previous !== null && compareDecimalStrings(previous, parsed.value) > 0) return null;
    limits[level] = parsed.value;
    previous = parsed.value;
  }
  return { limits: limits as Record<DiscountAuthorityLevel, DecimalString>, provisional: source.provisional === true };
}

/** Authority for one order line. A line without a discount needs none, whatever the role or configuration. */
export function evaluateItemDiscountAuthority(
  item: Pick<OrderItem, 'discountPercent' | 'priceState'>,
  actorRole: AccountRole,
  config: DiscountAuthorityConfiguration | undefined,
): DiscountAuthorityDecision {
  if (isZeroDecimal(item.discountPercent)) return WITHIN;
  if (item.priceState !== 'priced') return refused('price_base_missing');

  const resolved = resolveDiscountAuthority(config);
  if (resolved === null) return refused('authority_not_configured');
  const limits = resolved.limits;

  const actorLevel = discountAuthorityLevelOf(actorRole);
  if (actorLevel === null) return refused('actor_out_of_chain');

  const required = DISCOUNT_AUTHORITY_LEVELS.find((level) => compareDecimalStrings(item.discountPercent, limits[level]) <= 0);
  if (required === undefined) return refused('above_ceiling');
  if (DISCOUNT_AUTHORITY_LEVELS.indexOf(required) <= DISCOUNT_AUTHORITY_LEVELS.indexOf(actorLevel)) return WITHIN;
  return { decision: 'needs_approval', level: required as Exclude<DiscountAuthorityLevel, 'seller'> };
}

/** Order-level routing: refusal wins, otherwise the highest level any line needs. */
export function evaluateOrderDiscountAuthority(
  items: readonly Pick<OrderItem, 'lineNo' | 'discountPercent' | 'priceState'>[],
  actorRole: AccountRole,
  config: DiscountAuthorityConfiguration | undefined,
): OrderDiscountAuthority {
  const lines: LineDiscountAuthority[] = items.map((item) => ({
    lineNo: item.lineNo,
    result: evaluateItemDiscountAuthority(item, actorRole, config),
  }));
  const firstRefusal = lines.find((line) => line.result.decision === 'refused');
  if (firstRefusal !== undefined) return { ...firstRefusal.result, lines };

  let level: 'manager' | 'director' | null = null;
  for (const line of lines) {
    if (line.result.decision !== 'needs_approval') continue;
    if (level === null || line.result.level === 'director') level = line.result.level;
  }
  return level === null ? { ...WITHIN, lines } : { decision: 'needs_approval', level, lines };
}
