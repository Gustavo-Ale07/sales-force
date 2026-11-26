import { describe, expect, it } from 'vitest';
import { pricesDiffer, resolvePriceReview } from '../src/price-review.js';

describe('pricesDiffer', () => {
  it('treats equal decimals with different scale as equal', () => {
    expect(pricesDiffer('10.50', '10.5')).toBe(false);
  });
  it('detects a changed price', () => {
    expect(pricesDiffer('10.50', '11.00')).toBe(true);
  });
  it('a missing price is a difference, never zero', () => {
    expect(pricesDiffer('10.00', null)).toBe(true);
    expect(pricesDiffer(null, '10.00')).toBe(true);
    expect(pricesDiffer(null, null)).toBe(false);
    expect(pricesDiffer('0', null)).toBe(true);
  });
});

describe('resolvePriceReview', () => {
  const reviewed = [1, 3];
  it('keeps accepted lines and drops refused ones', () => {
    const result = resolvePriceReview(reviewed, [
      { lineNo: 1, decision: 'accept' },
      { lineNo: 3, decision: 'refuse' },
    ]);
    expect(result).toEqual({ ok: true, refused: [3] });
  });
  it('requires a decision for every reviewed line', () => {
    expect(resolvePriceReview(reviewed, [{ lineNo: 1, decision: 'accept' }])).toEqual({ ok: false, reason: 'missing_decision', lineNos: [3] });
  });
  it('rejects a decision for a line that was not reviewed or repeated', () => {
    expect(resolvePriceReview(reviewed, [{ lineNo: 1, decision: 'accept' }, { lineNo: 3, decision: 'accept' }, { lineNo: 2, decision: 'accept' }])).toEqual({ ok: false, reason: 'unknown_line', lineNos: [2] });
    expect(resolvePriceReview(reviewed, [{ lineNo: 1, decision: 'accept' }, { lineNo: 1, decision: 'refuse' }, { lineNo: 3, decision: 'accept' }])).toEqual({ ok: false, reason: 'duplicate_decision', lineNos: [1] });
  });
});
