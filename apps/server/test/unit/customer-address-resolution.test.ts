import { describe, expect, it } from 'vitest';
import { resolveAddresses, type AddressRegistry } from '../../src/customers/customer-address-resolution.js';
import type { CustomerUpsertAddress } from '../../src/customers/customer-registration-request.js';

const registry: AddressRegistry = {
  cityExists: async (code) => code === 10,
  neighborhoodExists: async (code) => code === 3,
  streetExists: async (code) => code === 7,
  neighborhoodRegistry: async () => [{ code: 3, name: 'Centro' }, { code: 4, name: 'Jardim Açucena' }],
  streetRegistry: async () => [{ code: 7, name: 'DAS FLORES', kind: 'RUA' }],
};

const address = (overrides: Partial<CustomerUpsertAddress> = {}): CustomerUpsertAddress => ({
  cityCode: 10,
  streetCode: 0,
  neighborhoodCode: 0,
  streetName: null,
  neighborhoodName: null,
  number: null,
  complement: null,
  postalCode: null,
  ...overrides,
});

describe('resolveAddresses (P-08: validated against the mirror)', () => {
  it('accepts a known city with no street or neighborhood', async () => {
    const result = await resolveAddresses([address()], registry);
    expect(result).toEqual({ ok: true, addresses: [address()] });
  });

  it('refuses an unknown city, naming the field', async () => {
    const result = await resolveAddresses([address({ cityCode: 99 })], registry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([expect.objectContaining({ path: 'addresses.0.cityCode', code: 'city_not_found' })]);
  });

  it('refuses unknown neighborhood and street codes', async () => {
    const result = await resolveAddresses([address({ neighborhoodCode: 99, streetCode: 98 })], registry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.path)).toEqual(['addresses.0.neighborhoodCode', 'addresses.0.streetCode']);
  });

  it('turns a name that matches the mirror (no accents, any case) into the ERP code', async () => {
    const result = await resolveAddresses([address({ neighborhoodName: 'jardim acucena', streetName: 'Rua das Flores' })], registry);
    expect(result).toEqual({ ok: true, addresses: [address({ neighborhoodCode: 4, streetCode: 7 })] });
  });

  it('keeps the text when nothing matches, for the worker to create', async () => {
    const result = await resolveAddresses([address({ neighborhoodName: 'Bairro Novo', streetName: 'Rua Nova' })], registry);
    expect(result).toEqual({ ok: true, addresses: [address({ neighborhoodName: 'Bairro Novo', streetName: 'Rua Nova' })] });
  });

  it('a code wins over a name sent with it', async () => {
    const result = await resolveAddresses([address({ neighborhoodCode: 3, neighborhoodName: 'Qualquer' })], registry);
    expect(result).toEqual({ ok: true, addresses: [address({ neighborhoodCode: 3 })] });
  });

  it('refuses an unsafe or too long free name on the field, before the worker (same rule as the registry write)', async () => {
    const result = await resolveAddresses(
      [address({ neighborhoodName: "X' OR 1=1 --", streetName: 'Rua ' + 'A'.repeat(61) })],
      registry,
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [
        { path: 'addresses.0.neighborhoodName', code: 'registry_name_invalid' },
        { path: 'addresses.0.streetName', code: 'registry_name_too_long' },
      ],
    });
  });
});
