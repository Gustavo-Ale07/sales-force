import { describe, expect, it } from 'vitest';
import { CreateCustomerRequestSchema } from '../src/customer-write.js';

const base = {
  clientRequestId: '0194a1b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b',
  document: '11222333000181',
  name: 'Cliente de teste',
};
const address = { streetCode: 1, neighborhoodCode: 2, number: '10', complement: null, postalCode: '01310100' };

function messages(input: Record<string, unknown>): string[] {
  const result = CreateCustomerRequestSchema.safeParse({ ...base, ...input });
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

/** TGFPAR limits read in the Sandbox (owner, 2026-11-13). Over the limit is refused, never cut. */
describe('CreateCustomerRequest field limits (TGFPAR)', () => {
  it('accepts values exactly at the limit', () => {
    const result = CreateCustomerRequestSchema.safeParse({
      ...base,
      name: 'N'.repeat(100),
      tradeName: 'R'.repeat(100),
      stateRegistration: 'I'.repeat(16),
      email: `${'a'.repeat(68)}@exemplo.com`,
      phone: '1'.repeat(13),
      notes: 'o'.repeat(4000),
      addresses: [{ ...address, number: '123456', complement: 'c'.repeat(30) }],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['name', { name: 'N'.repeat(101) }],
    ['tradeName', { tradeName: 'R'.repeat(101) }],
    ['stateRegistration', { stateRegistration: 'I'.repeat(17) }],
    ['email', { email: `${'a'.repeat(72)}@exemplo.com` }],
    ['phone', { phone: '1'.repeat(14) }],
    ['notes', { notes: 'o'.repeat(4001) }],
    ['addresses.0.number', { addresses: [{ ...address, number: '1234567' }] }],
    ['addresses.0.complement', { addresses: [{ ...address, complement: 'c'.repeat(31) }] }],
  ])('refuses %s over the limit with a message that names the field', (field, input) => {
    const found = messages(input);
    expect(found.some((entry) => entry.startsWith(field))).toBe(true);
  });

  it('phone is digits only, up to 13', () => {
    expect(messages({ phone: '(11) 99999-0000' }).some((entry) => entry.startsWith('phone'))).toBe(true);
    expect(CreateCustomerRequestSchema.safeParse({ ...base, phone: '11999990000' }).success).toBe(true);
  });

  it('postal code is exactly 8 digits', () => {
    expect(messages({ addresses: [{ ...address, postalCode: '01310-100' }] }).length).toBeGreaterThan(0);
    expect(messages({ addresses: [{ ...address, postalCode: '0131010' }] }).length).toBeGreaterThan(0);
  });

  it('document has at most 14 digits once punctuation is removed', () => {
    expect(messages({ document: '112223330001811' }).some((entry) => entry.startsWith('document'))).toBe(true);
    expect(CreateCustomerRequestSchema.safeParse({ ...base, document: '11.222.333/0001-81' }).success).toBe(true);
  });
});
