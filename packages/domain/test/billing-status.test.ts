import { describe, expect, it } from 'vitest';
import { billingItemQuantities, billingStateOf, isFinalBillingState, type ErpBillingFacts } from '../src/index.js';

const facts = (over: Partial<ErpBillingFacts> = {}): ErpBillingFacts => ({
  cancelled: false,
  releaseState: null,
  invoiced: false,
  statusNota: null,
  pending: null,
  ...over,
});

describe('billingStateOf', () => {
  it('cancelled wins over everything', () => {
    expect(billingStateOf(facts({ cancelled: true, releaseState: 'denied', invoiced: true, statusNota: 'L', pending: 'S' }))).toBe('cancelled');
  });

  it('denied wins over awaiting, invoiced and the note state', () => {
    expect(billingStateOf(facts({ releaseState: 'denied', invoiced: true, statusNota: 'L' }))).toBe('denied');
  });

  it('awaiting release wins over invoiced and awaiting billing', () => {
    expect(billingStateOf(facts({ releaseState: 'awaiting', invoiced: true, statusNota: 'L', pending: 'S' }))).toBe('awaiting_release');
  });

  it('invoiced wins over awaiting billing', () => {
    expect(billingStateOf(facts({ releaseState: 'released', invoiced: true, statusNota: 'L', pending: 'S' }))).toBe('invoiced');
  });

  it('awaiting billing: confirmed note, pending, no sale note', () => {
    expect(billingStateOf(facts({ releaseState: 'released', statusNota: 'L', pending: 'S' }))).toBe('awaiting_billing');
  });

  it('sent without confirmation: STATUSNOTA A and nothing pending release', () => {
    expect(billingStateOf(facts({ statusNota: 'A', pending: 'S' }))).toBe('sent');
    expect(billingStateOf(facts({ releaseState: 'released', statusNota: 'A' }))).toBe('sent');
  });

  it('a confirmed note that fits no state has none; a missing note is never "cancelled"', () => {
    expect(billingStateOf(facts({ statusNota: 'L', pending: 'N' }))).toBeNull();
    expect(billingStateOf(facts())).toBeNull();
  });
});

describe('isFinalBillingState', () => {
  it('only cancelled and invoiced are final', () => {
    expect(isFinalBillingState('cancelled')).toBe(true);
    expect(isFinalBillingState('invoiced')).toBe(true);
    for (const state of ['denied', 'awaiting_release', 'awaiting_billing', 'sent', null] as const) expect(isFinalBillingState(state)).toBe(false);
  });
});

describe('billingItemQuantities', () => {
  it('invoiced is QTDENTREGUE; nothing is cut while the item is still pending', () => {
    expect(billingItemQuantities({ ordered: '10', delivered: '4', pending: 'S' })).toEqual({ invoiced: '4', cut: '0' });
  });

  it('cut is the remainder once the item is no longer pending', () => {
    expect(billingItemQuantities({ ordered: '10', delivered: '4', pending: 'N' })).toEqual({ invoiced: '4', cut: '6' });
  });

  it('fully delivered has no cut', () => {
    expect(billingItemQuantities({ ordered: '10', delivered: '10', pending: 'N' })).toEqual({ invoiced: '10', cut: '0' });
  });

  it('keeps fractional quantities exact', () => {
    expect(billingItemQuantities({ ordered: '2.5', delivered: '1.25', pending: 'N' })).toEqual({ invoiced: '1.25', cut: '1.25' });
    expect(billingItemQuantities({ ordered: '0.3', delivered: '0.1', pending: 'N' })).toEqual({ invoiced: '0.1', cut: '0.2' });
  });

  it('delivered above ordered never produces a negative cut; unreadable numbers yield zeros', () => {
    expect(billingItemQuantities({ ordered: '1', delivered: '2', pending: 'N' })).toEqual({ invoiced: '2', cut: '0' });
    expect(billingItemQuantities({ ordered: 'x', delivered: '2', pending: 'N' })).toEqual({ invoiced: '0', cut: '0' });
  });
});
