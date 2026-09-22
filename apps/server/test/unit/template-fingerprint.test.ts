import { describe, expect, it } from 'vitest';
import { templateFingerprint } from '../../src/templates/template-fingerprint.js';

const base = { customerCode: 10, name: 'Reposição', items: [{ productCode: 1, quantity: '2' }, { productCode: 2, quantity: '3.5' }] };

describe('templateFingerprint', () => {
  it('is a stable SHA-256 hex of the canonical content', () => {
    expect(templateFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(templateFingerprint({ ...base })).toBe(templateFingerprint(base));
  });

  it('changes with the customer, the name, a quantity, a product or the line order', () => {
    const reference = templateFingerprint(base);
    expect(templateFingerprint({ ...base, customerCode: 11 })).not.toBe(reference);
    expect(templateFingerprint({ ...base, name: 'reposição' })).not.toBe(reference);
    expect(templateFingerprint({ ...base, items: [{ productCode: 1, quantity: '9' }, base.items[1]!] })).not.toBe(reference);
    expect(templateFingerprint({ ...base, items: [{ productCode: 3, quantity: '2' }, base.items[1]!] })).not.toBe(reference);
    expect(templateFingerprint({ ...base, items: [base.items[1]!, base.items[0]!] })).not.toBe(reference);
  });
});
