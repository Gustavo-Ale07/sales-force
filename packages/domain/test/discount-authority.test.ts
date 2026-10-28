import { describe, expect, it } from 'vitest';
import {
  buildOrderItem,
  evaluateItemDiscountAuthority,
  evaluateOrderDiscountAuthority,
  validateConfigurationConsistency,
  type DiscountAuthorityConfiguration,
  type OrderItem,
  type ResolvedPrice,
} from '../src/index.js';
import { makeConfig, makeProduct } from './fixtures.js';

// Synthetic limits for tests only: the real values come from the installation configuration and are not decided here.
const LIMITS: DiscountAuthorityConfiguration = { limits: { seller: '5', manager: '10', director: '20' } };

const priced: ResolvedPrice = { state: 'priced', unitPrice: '100', tableCode: 88, versionId: 4 };
const zero: ResolvedPrice = { state: 'zero', unitPrice: '0', tableCode: 88, versionId: 4 };
const none: ResolvedPrice = { state: 'none', reason: 'no_price_row', tableCode: 88, versionId: 4 };
const product = makeProduct({ code: 3001, description: 'Produto A', unit: 'CX' });

function item(discountPercent: string, price: ResolvedPrice = priced, lineNo = 1): OrderItem {
  const built = buildOrderItem({ lineNo, product, quantity: '1', price, discountPercent });
  if (!built.ok) throw new Error('fixture: ' + built.error);
  return built.value;
}

describe('evaluateItemDiscountAuthority', () => {
  it('needs no authority without a discount, whatever the role or configuration', () => {
    for (const role of ['seller', 'manager', 'admin', 'technical'] as const) {
      expect(evaluateItemDiscountAuthority(item('0'), role, undefined)).toEqual({ decision: 'within_authority' });
    }
    expect(evaluateItemDiscountAuthority(item('0', none), 'seller', undefined)).toEqual({ decision: 'within_authority' });
  });

  it('seller: within up to and including the seller limit', () => {
    expect(evaluateItemDiscountAuthority(item('4.99'), 'seller', LIMITS).decision).toBe('within_authority');
    expect(evaluateItemDiscountAuthority(item('5'), 'seller', LIMITS).decision).toBe('within_authority');
  });

  it('seller: just above the limit needs the manager, and the manager limit is inclusive', () => {
    expect(evaluateItemDiscountAuthority(item('5.01'), 'seller', LIMITS)).toEqual({ decision: 'needs_approval', level: 'manager' });
    expect(evaluateItemDiscountAuthority(item('10'), 'seller', LIMITS)).toEqual({ decision: 'needs_approval', level: 'manager' });
  });

  it('seller: above the manager limit needs the director', () => {
    expect(evaluateItemDiscountAuthority(item('10.01'), 'seller', LIMITS)).toEqual({ decision: 'needs_approval', level: 'director' });
    expect(evaluateItemDiscountAuthority(item('20'), 'seller', LIMITS)).toEqual({ decision: 'needs_approval', level: 'director' });
  });

  it('manager: own authority covers the manager range, the director is needed above it', () => {
    expect(evaluateItemDiscountAuthority(item('3'), 'manager', LIMITS).decision).toBe('within_authority');
    expect(evaluateItemDiscountAuthority(item('10'), 'manager', LIMITS).decision).toBe('within_authority');
    expect(evaluateItemDiscountAuthority(item('10.01'), 'manager', LIMITS)).toEqual({ decision: 'needs_approval', level: 'director' });
  });

  it('above the director limit is refused: the absolute ceiling is not decided, never auto-approved', () => {
    expect(evaluateItemDiscountAuthority(item('20.01'), 'seller', LIMITS)).toEqual({ decision: 'refused', reason: 'ceiling_not_decided' });
    expect(evaluateItemDiscountAuthority(item('99.99'), 'manager', LIMITS)).toEqual({ decision: 'refused', reason: 'ceiling_not_decided' });
  });

  it('a missing price (state none) is not a base: a discount on it is refused', () => {
    expect(evaluateItemDiscountAuthority(item('1', none), 'seller', LIMITS)).toEqual({ decision: 'refused', reason: 'price_base_missing' });
  });

  it('an explicit zero price is not a usable base either', () => {
    expect(evaluateItemDiscountAuthority(item('1', zero), 'seller', LIMITS)).toEqual({ decision: 'refused', reason: 'price_base_missing' });
  });

  it('refuses a discount when authority is not configured (fail closed)', () => {
    expect(evaluateItemDiscountAuthority(item('1'), 'seller', undefined)).toEqual({ decision: 'refused', reason: 'authority_not_configured' });
  });

  it('refuses when any level limit is missing or the limits are not ascending', () => {
    const missing: DiscountAuthorityConfiguration = { limits: { seller: '5', manager: null, director: '20' } };
    const descending: DiscountAuthorityConfiguration = { limits: { seller: '10', manager: '5', director: '20' } };
    expect(evaluateItemDiscountAuthority(item('1'), 'seller', missing)).toEqual({ decision: 'refused', reason: 'authority_not_configured' });
    expect(evaluateItemDiscountAuthority(item('1'), 'seller', descending)).toEqual({ decision: 'refused', reason: 'authority_not_configured' });
  });

  it('refuses a malformed limit instead of guessing', () => {
    const bad: DiscountAuthorityConfiguration = { limits: { seller: 'abc', manager: '10', director: '20' } };
    expect(evaluateItemDiscountAuthority(item('1'), 'seller', bad)).toEqual({ decision: 'refused', reason: 'authority_not_configured' });
  });

  it('roles outside the seller -> manager -> director chain cannot hold discount authority', () => {
    expect(evaluateItemDiscountAuthority(item('1'), 'admin', LIMITS)).toEqual({ decision: 'refused', reason: 'actor_out_of_chain' });
    expect(evaluateItemDiscountAuthority(item('1'), 'technical', LIMITS)).toEqual({ decision: 'refused', reason: 'actor_out_of_chain' });
  });

  it('the result never carries cost or margin (P-20)', () => {
    const json = JSON.stringify([
      evaluateItemDiscountAuthority(item('7'), 'seller', LIMITS),
      evaluateOrderDiscountAuthority([item('7')], 'seller', LIMITS),
    ]);
    expect(json).not.toMatch(/cost|margin|custo|margem/i);
  });
});

describe('evaluateOrderDiscountAuthority', () => {
  it('an order without discounted lines is within authority', () => {
    expect(evaluateOrderDiscountAuthority([item('0'), item('0', none, 2)], 'seller', undefined).decision).toBe('within_authority');
    expect(evaluateOrderDiscountAuthority([], 'seller', LIMITS).decision).toBe('within_authority');
  });

  it('takes the highest requirement among the lines', () => {
    const result = evaluateOrderDiscountAuthority([item('2', priced, 1), item('8', priced, 2), item('15', priced, 3)], 'seller', LIMITS);
    expect(result).toMatchObject({ decision: 'needs_approval', level: 'director' });
    expect(result.lines.map((l) => l.lineNo)).toEqual([1, 2, 3]);
  });

  it('manager needed when it is the highest', () => {
    const result = evaluateOrderDiscountAuthority([item('2', priced, 1), item('8', priced, 2)], 'seller', LIMITS);
    expect(result).toMatchObject({ decision: 'needs_approval', level: 'manager' });
  });

  it('a refused line makes the whole order refused, even when others need only approval', () => {
    const result = evaluateOrderDiscountAuthority([item('15', priced, 1), item('1', none, 2)], 'seller', LIMITS);
    expect(result).toMatchObject({ decision: 'refused', reason: 'price_base_missing' });
  });

  it('a mixed order stays within when every line is within', () => {
    expect(evaluateOrderDiscountAuthority([item('1', priced, 1), item('5', priced, 2)], 'seller', LIMITS).decision).toBe('within_authority');
  });
});

describe('configuration consistency for discount authority', () => {
  const withLimits = (limits: DiscountAuthorityConfiguration['limits']) =>
    makeConfig((c) => ({ ...c, sales: { ...c.sales, discountAuthority: { limits } } }));
  const codes = (l: DiscountAuthorityConfiguration['limits']) => validateConfigurationConsistency(withLimits(l)).map((i) => i.code);

  it('accepts ascending limits, an absent block and an all-null block', () => {
    expect(validateConfigurationConsistency(makeConfig())).toEqual([]);
    expect(codes({ seller: '5', manager: '10', director: '20' })).toEqual([]);
    expect(codes({ seller: null, manager: null, director: null })).toEqual([]);
  });

  it('flags non-ascending, malformed or out of range limits', () => {
    expect(codes({ seller: '10', manager: '5', director: '20' })).toContain('discount_authority_limits_not_ascending');
    expect(codes({ seller: 'x', manager: '5', director: '20' })).toContain('discount_authority_limit_invalid');
    expect(codes({ seller: '5', manager: '10', director: '100' })).toContain('discount_authority_limit_invalid');
  });
});
