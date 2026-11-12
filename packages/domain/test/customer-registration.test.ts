import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_EDITABLE_FIELDS,
  customerOriginKey,
  formatTaxDocument,
  isValidCnpj,
  isValidCpf,
  normalizeTaxDocument,
  parseCustomerOriginKey,
  rejectedCustomerEditFields,
  taxDocumentKind,
} from '../src/index.js';

describe('tax document (CPF / CNPJ)', () => {
  it('normalizes by keeping digits only', () => {
    expect(normalizeTaxDocument('529.982.247-25')).toBe('52998224725');
    expect(normalizeTaxDocument(' 11.222.333/0001-81 ')).toBe('11222333000181');
    expect(normalizeTaxDocument('')).toBe('');
  });

  it('validates CPF check digits', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('1234567890')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });

  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
  });

  it('tells the kind from a valid document only', () => {
    expect(taxDocumentKind('529.982.247-25')).toBe('individual');
    expect(taxDocumentKind('11.222.333/0001-81')).toBe('company');
    expect(taxDocumentKind('123')).toBeNull();
    expect(taxDocumentKind('52998224726')).toBeNull();
  });

  it('formats with the pt-BR mask and leaves invalid lengths untouched', () => {
    expect(formatTaxDocument('52998224725')).toBe('529.982.247-25');
    expect(formatTaxDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatTaxDocument('123')).toBe('123');
  });
});

describe('customer origin key (idempotency)', () => {
  const id = '0190a0c0-0000-7000-8000-000000000001';

  it('builds and parses the key and fits the 100-character field', () => {
    const key = customerOriginKey(id);
    expect(key).toBe(`force:${id}`);
    expect(key.length).toBe(42);
    expect(parseCustomerOriginKey(key)).toBe(id);
  });

  it('refuses anything that is not a force key with a UUID', () => {
    expect(() => customerOriginKey('not-a-uuid')).toThrow();
    expect(parseCustomerOriginKey('vidya:' + id)).toBeNull();
    expect(parseCustomerOriginKey('force:xyz')).toBeNull();
    expect(parseCustomerOriginKey(null)).toBeNull();
  });
});

describe('customer edit policy (allow-list)', () => {
  it('lists only phone, e-mail, contacts, addresses and notes', () => {
    expect([...CUSTOMER_EDITABLE_FIELDS].sort()).toEqual(['addresses', 'contacts', 'email', 'notes', 'phone']);
  });

  it('rejects every other field, even when the client sends it', () => {
    expect(rejectedCustomerEditFields({ phone: '1', email: 'a@b.c' })).toEqual([]);
    expect(
      rejectedCustomerEditFields({ phone: '1', document: 'x', legalName: 'x', creditLimit: 1, priceTable: 5, sellerCode: 1, active: true, mobility: 'S' }).sort(),
    ).toEqual(['active', 'creditLimit', 'document', 'legalName', 'mobility', 'priceTable', 'sellerCode']);
  });

  it('an empty change is rejected as having nothing to edit', () => {
    expect(rejectedCustomerEditFields({})).toEqual([]);
  });
});
