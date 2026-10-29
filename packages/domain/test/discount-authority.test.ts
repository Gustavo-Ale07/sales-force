import { describe, expect, it } from 'vitest';
import {
  buildOrderItem,
  PROVISIONAL_DISCOUNT_AUTHORITY,
  evaluateItemDiscountAuthority,
  resolveDiscountAuthority,
  canRoleApproveLevel,
  approvableLevelsOf,
  recomputeOrderAuthority,
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

  it('above the director limit is refused: the director limit is the absolute ceiling, nobody approves', () => {
    expect(evaluateItemDiscountAuthority(item('20.01'), 'seller', LIMITS)).toEqual({ decision: 'refused', reason: 'above_ceiling' });
    expect(evaluateItemDiscountAuthority(item('99.99'), 'manager', LIMITS)).toEqual({ decision: 'refused', reason: 'above_ceiling' });
  });

  it('a missing price (state none) is not a base: a discount on it is refused', () => {
    expect(evaluateItemDiscountAuthority(item('1', none), 'seller', LIMITS)).toEqual({ decision: 'refused', reason: 'price_base_missing' });
  });

  it('an explicit zero price is not a usable base either', () => {
    expect(evaluateItemDiscountAuthority(item('1', zero), 'seller', LIMITS)).toEqual({ decision: 'refused', reason: 'price_base_missing' });
  });

  it('absent configuration uses the provisional 5/15/30 defaults (Q11), inclusive at each limit', () => {
    expect(PROVISIONAL_DISCOUNT_AUTHORITY.limits).toEqual({ seller: '5', manager: '15', director: '30' });
    expect(evaluateItemDiscountAuthority(item('5'), 'seller', undefined).decision).toBe('within_authority');
    expect(evaluateItemDiscountAuthority(item('15'), 'seller', undefined)).toEqual({ decision: 'needs_approval', level: 'manager' });
    expect(evaluateItemDiscountAuthority(item('30'), 'seller', undefined)).toEqual({ decision: 'needs_approval', level: 'director' });
    expect(evaluateItemDiscountAuthority(item('30.01'), 'seller', undefined)).toEqual({ decision: 'refused', reason: 'above_ceiling' });
  });

  it('resolveDiscountAuthority flags the provisional defaults and passes a stored block through', () => {
    expect(resolveDiscountAuthority(undefined)).toEqual({ limits: PROVISIONAL_DISCOUNT_AUTHORITY.limits, provisional: true });
    expect(resolveDiscountAuthority(LIMITS)).toEqual({ limits: LIMITS.limits, provisional: false });
    expect(resolveDiscountAuthority({ limits: { seller: '5', manager: null, director: '20' } })).toBeNull();
    expect(resolveDiscountAuthority({ ...LIMITS, provisional: true })?.provisional).toBe(true);
  });

  it('a per-user override block is accepted by the shape but not evaluated yet (RF-CAT-3 is post-pilot, Q8)', () => {
    const withOverride: DiscountAuthorityConfiguration = {
      ...LIMITS,
      userOverrides: [{ username: 'joao', limits: { seller: '25', manager: '26', director: '27' } }],
    };
    expect(evaluateItemDiscountAuthority(item('6'), 'seller', withOverride)).toEqual({ decision: 'needs_approval', level: 'manager' });
    expect(validateConfigurationConsistency(makeConfig((c) => ({ ...c, sales: { ...c.sales, discountAuthority: withOverride } })))).toEqual([]);
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

describe('who may approve a level (DISC-4, Q6)', () => {
  it('the manager approves the manager level; the admin approves the director level ("Diretoria"); nobody else', () => {
    expect(canRoleApproveLevel('manager', 'manager')).toBe(true);
    expect(canRoleApproveLevel('manager', 'director')).toBe(false);
    expect(canRoleApproveLevel('admin', 'director')).toBe(true);
    expect(canRoleApproveLevel('admin', 'manager')).toBe(false);
    for (const level of ['manager', 'director'] as const) {
      expect(canRoleApproveLevel('seller', level)).toBe(false);
      expect(canRoleApproveLevel('technical', level)).toBe(false);
    }
  });

  it('lists the levels a role may decide', () => {
    expect(approvableLevelsOf('manager')).toEqual(['manager']);
    expect(approvableLevelsOf('admin')).toEqual(['director']);
    expect(approvableLevelsOf('seller')).toEqual([]);
    expect(approvableLevelsOf('technical')).toEqual([]);
  });
});

describe('recomputeOrderAuthority: the draft owner decides, not who saved (DISC-5, Q12)', () => {
  const lines = [{ lineNo: 1, discountPercent: '8', priceState: 'priced' as const }];

  it('uses the owner role: 8% is manager-level for a seller owner, within authority for a manager owner', () => {
    expect(recomputeOrderAuthority(lines, 'seller', LIMITS)).toEqual({ status: 'needs_manager', level: 'manager' });
    expect(recomputeOrderAuthority([{ ...lines[0]!, discountPercent: '12' }], 'manager', LIMITS)).toEqual({ status: 'needs_director', level: 'director' });
    expect(recomputeOrderAuthority([{ ...lines[0]!, discountPercent: '10' }], 'manager', LIMITS)).toEqual({ status: 'within_authority', level: null });
  });

  it('blocks above the ceiling and for an owner outside the chain, with the reason', () => {
    expect(recomputeOrderAuthority([{ ...lines[0]!, discountPercent: '20.01' }], 'seller', LIMITS)).toMatchObject({ status: 'blocked' });
    expect(recomputeOrderAuthority(lines, 'admin', LIMITS)).toMatchObject({ status: 'blocked' });
  });
});
