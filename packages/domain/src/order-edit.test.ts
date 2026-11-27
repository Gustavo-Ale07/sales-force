import { describe, expect, it } from 'vitest';
import { canEditFromStage, canEditOrder, evaluateOrderEdit, type OrderEditFacts } from './order-edit.js';

const open: OrderEditFacts = { nunota: 2513, statusnota: 'A', ordemcarga: null, hasReleaseLines: false, hasInvoiceLink: false, hasDefinitiveFinancial: false };

describe('evaluateOrderEdit', () => {
  it('allows an untouched unconfirmed note (delete and recreate)', () => {
    expect(evaluateOrderEdit(open)).toEqual({ canEdit: true, mode: 'delete_and_recreate' });
  });
  it('allows an order with no note as a plain re-send', () => {
    expect(evaluateOrderEdit({ ...open, nunota: null, statusnota: null })).toEqual({ canEdit: true, mode: 'resend' });
  });
  it.each([
    [{ statusnota: 'L' }, 'confirmed'],
    [{ hasInvoiceLink: true }, 'invoiced'],
    [{ ordemcarga: 7 }, 'in_load'],
    [{ hasReleaseLines: true }, 'has_release'],
    [{ hasDefinitiveFinancial: true }, 'financial_generated'],
    [{ statusnota: null }, 'unknown_status'],
    [{ statusnota: 'X' }, 'unknown_status'],
  ] as const)('refuses %j', (patch, reason) => {
    expect(evaluateOrderEdit({ ...open, ...patch })).toEqual({ canEdit: false, reason });
    expect(canEditOrder({ ...open, ...patch })).toBe(false);
  });
  it('treats a zero load as no load', () => {
    expect(canEditOrder({ ...open, ordemcarga: 0 })).toBe(true);
  });
});

describe('canEditFromStage', () => {
  it('is true only for the received stage or a rejected order without a note', () => {
    expect(canEditFromStage({ code: 'received' }, true, 'queued')).toBe(true);
    expect(canEditFromStage({ code: 'in_dispatch' }, true, 'queued')).toBe(false);
    expect(canEditFromStage(null, true, 'queued')).toBe(false);
    expect(canEditFromStage(null, false, 'rejected')).toBe(true);
    expect(canEditFromStage(null, false, 'draft')).toBe(false);
  });
});
