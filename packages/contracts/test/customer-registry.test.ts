import { describe, expect, it } from 'vitest';
import { CustomerDetailSchema, CustomerListItemSchema, CustomerRegistrySchema } from '../src/index.js';

const BASE = { code: 1, name: 'Cliente', tradeName: null, document: null, active: true, blocked: false, sellerCode: 7, sellerName: null, priceTableCode: 5 };
const REGISTRY = {
  postalCode: '01310100', street: 'Rua Teste', number: '10', complement: null, neighborhood: 'Centro', city: 'Cidade', state: 'SP', mobile: null, phone: null, email: null,
};

describe('customer registry (additive, spike 9.70)', () => {
  it('an older payload without registry or defaultCarrierCode still parses (no version bump)', () => {
    expect(CustomerListItemSchema.safeParse(BASE).success).toBe(true);
  });

  it('accepts the registry and a null default carrier, every registry field nullable', () => {
    const parsed = CustomerListItemSchema.parse({ ...BASE, registry: REGISTRY, defaultCarrierCode: null });
    expect(parsed.registry?.street).toBe('Rua Teste');
    expect(parsed.defaultCarrierCode).toBeNull();
    expect(CustomerRegistrySchema.safeParse({ ...REGISTRY, street: null, state: null }).success).toBe(true);
  });

  it('rejects a registry with a missing field (shape stays closed) and non-text values', () => {
    const incomplete: Record<string, unknown> = { ...REGISTRY };
    delete incomplete["street"];
    expect(CustomerRegistrySchema.safeParse(incomplete).success).toBe(false);
    expect(CustomerRegistrySchema.safeParse({ ...REGISTRY, number: 10 }).success).toBe(false);
  });

  it('the detail carries it too, and no cost or margin key is part of the registry (P-20)', () => {
    expect(Object.keys(CustomerRegistrySchema.shape).sort()).toEqual(
      ['city', 'complement', 'email', 'mobile', 'neighborhood', 'number', 'phone', 'postalCode', 'state', 'street'],
    );
    const detail = CustomerDetailSchema.parse({
      ...BASE, priceTableName: null, resolvedPriceTable: null, creditLimit: null, monthlyCreditLimit: null, syncedAt: '2026-11-27T12:00:00.000Z', registry: REGISTRY, defaultCarrierCode: null,
    });
    expect(detail.registry?.postalCode).toBe('01310100');
  });
});
