import { describe, expect, it } from 'vitest';
import { CreateCustomerRequestSchema, PostalCodeLookupSchema } from '../src/index.js';

const base = {
  clientRequestId: '0198f0a2-7b1c-7c3e-9a55-0123456789ab',
  document: '11222333000181',
  name: 'Cliente Teste Ltda',
  stateRegistration: 'ISENTO',
};

const parse = (addresses: unknown[]) => CreateCustomerRequestSchema.safeParse({ ...base, addresses });

describe('customer address contract (cityCode required, street and neighborhood optional)', () => {
  it('accepts the city alone: codes default to 0 (none) and the other fields to null', () => {
    const result = parse([{ cityCode: 3550308 }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.addresses[0]).toEqual({
        cityCode: 3550308,
        streetCode: 0,
        neighborhoodCode: 0,
        streetName: null,
        neighborhoodName: null,
        number: null,
        complement: null,
        postalCode: null,
      });
    }
  });

  it('accepts codes, free names and an unmasked 8-digit postal code', () => {
    const result = parse([{ cityCode: 1, streetCode: 7, neighborhoodName: 'Jardim Novo', streetName: 'Rua Nova', number: '12', postalCode: '01310100' }]);
    expect(result.success).toBe(true);
  });

  it('refuses an address without a city (the shape of an old queued registration), naming the field', () => {
    const result = parse([{ streetCode: 7, neighborhoodCode: 3, number: '10', complement: null, postalCode: '01310100' }]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toContain('addresses.0.cityCode');
  });

  it('refuses city 0, a masked postal code and a negative street code', () => {
    expect(parse([{ cityCode: 0 }]).success).toBe(false);
    expect(parse([{ cityCode: 1, postalCode: '01310-100' }]).success).toBe(false);
    expect(parse([{ cityCode: 1, streetCode: -1 }]).success).toBe(false);
  });

  it('a registration with no address is unaffected', () => {
    expect(CreateCustomerRequestSchema.safeParse(base).success).toBe(true);
  });
});

describe('PostalCodeLookup', () => {
  it('describes a not-found answer with every field null', () => {
    const notFound = { found: false, postalCode: null, street: null, neighborhood: null, city: null, uf: null, cityCode: null, neighborhoodCode: null, streetCode: null, source: null };
    expect(PostalCodeLookupSchema.safeParse(notFound).success).toBe(true);
  });
});
