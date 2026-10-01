import { describe, expect, it } from 'vitest';
import { customerOrderBlock, isCustomerEligibleForOrder, isOperationalSellerCode } from '../src/index.js';

const eligible = { active: true, blocked: false, sellerCode: 900 };

describe('customerOrderBlock', () => {
  it('an active, unblocked customer with a valid seller can receive orders', () => {
    expect(customerOrderBlock(eligible)).toBeNull();
    expect(isCustomerEligibleForOrder(eligible)).toBe(true);
  });
  it('inactive customer is blocked', () => {
    expect(customerOrderBlock({ ...eligible, active: false })).toBe('customer_inactive');
  });
  it('blocked customer is blocked', () => {
    expect(customerOrderBlock({ ...eligible, blocked: true })).toBe('customer_blocked');
  });
  it.each([0, null, -1, 1.5, Number.NaN])('seller %s is never an operational seller', (sellerCode) => {
    expect(customerOrderBlock({ ...eligible, sellerCode })).toBe('customer_without_seller');
    expect(isOperationalSellerCode(sellerCode)).toBe(false);
  });
  it('inactive wins over blocked, which wins over a missing seller (deterministic reason)', () => {
    expect(customerOrderBlock({ active: false, blocked: true, sellerCode: null })).toBe('customer_inactive');
    expect(customerOrderBlock({ active: true, blocked: true, sellerCode: 0 })).toBe('customer_blocked');
  });
  it('a customer that is not (or no longer) available in the mirror is blocked, fail-closed', () => {
    expect(customerOrderBlock(null)).toBe('customer_unavailable');
    expect(isCustomerEligibleForOrder(null)).toBe(false);
  });
  it('seller 1 is the smallest valid code', () => {
    expect(isOperationalSellerCode(1)).toBe(true);
  });
});
