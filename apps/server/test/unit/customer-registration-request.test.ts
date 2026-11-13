import { CreateCustomerRequestSchema, type CreateCustomerRequest } from '@salesforce/contracts';
import { describe, expect, it } from 'vitest';
import { prepareCustomerRegistration } from '../../src/customers/customer-registration-request.js';

const ID = '0198f0a2-7b1c-7c3e-9a55-0123456789ab';
const CNPJ = '11.222.333/0001-81';
const CPF = '529.982.247-25';

function body(overrides: Record<string, unknown> = {}): CreateCustomerRequest {
  return CreateCustomerRequestSchema.parse({ clientRequestId: ID, document: CNPJ, name: 'Cliente Teste Ltda', stateRegistration: '123456789', ...overrides });
}

const seller = { role: 'seller', sellerCodes: [7] } as const;

describe('CreateCustomerRequestSchema', () => {
  it('applies the installation defaults: ICMS class R, no addresses, no optional data', () => {
    const parsed = body();
    expect(parsed).toMatchObject({ icmsClassification: 'R', addresses: [], phone: null, email: null, notes: null });
  });

  it.each(['creditLimit', 'priceTableCode', 'active', 'blocked', 'status', 'erpCode'])(
    'rejects the key %s instead of ignoring it',
    (key) => {
      expect(CreateCustomerRequestSchema.safeParse({ clientRequestId: ID, document: CNPJ, name: 'X', [key]: 1 }).success).toBe(false);
    },
  );

  it('rejects an ICMS class outside the allowed list', () => {
    expect(CreateCustomerRequestSchema.safeParse({ clientRequestId: ID, document: CNPJ, name: 'X', icmsClassification: 'Z' }).success).toBe(false);
  });
});

describe('prepareCustomerRegistration', () => {
  it('normalizes the document, derives the person type and the origin key', () => {
    const out = prepareCustomerRegistration(body(), seller);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.payload).toMatchObject({ document: '11222333000181', personType: 'company', originKey: `force:${ID}`, sellerCode: 7 });
  });

  it('accepts a valid CPF as an individual', () => {
    const out = prepareCustomerRegistration(body({ document: CPF, stateRegistration: null }), seller);
    expect(out.ok && out.value.payload.personType).toBe('individual');
  });

  describe('state registration (IE), owner ruling 2026-11-13', () => {
    const issue = { path: 'stateRegistration', code: 'state_registration_required' };

    it('a company without IE is refused', () => {
      expect(prepareCustomerRegistration(body({ stateRegistration: null }), seller)).toMatchObject({ ok: false, issues: [issue] });
    });

    it('a company with an IE of up to 16 characters is accepted, kept as typed (no per-state format check)', () => {
      const out = prepareCustomerRegistration(body({ stateRegistration: 'ab-12.345/6' }), seller);
      expect(out.ok && out.value.payload.stateRegistration).toBe('ab-12.345/6');
    });

    it.each(['Isento', 'ISENTO', 'isento', ' iSeNtO '])('"%s" means exempt and is stored as ISENTO', (typed) => {
      const out = prepareCustomerRegistration(body({ stateRegistration: typed }), seller);
      expect(out.ok && out.value.payload.stateRegistration).toBe('ISENTO');
    });

    it('an individual has no IE field: sending one is refused', () => {
      expect(prepareCustomerRegistration(body({ document: CPF, stateRegistration: '123' }), seller)).toMatchObject({
        ok: false,
        issues: [{ path: 'stateRegistration', code: 'state_registration_not_applicable' }],
      });
    });

    it('an individual without IE is accepted and carries none', () => {
      const out = prepareCustomerRegistration(body({ document: CPF, stateRegistration: null }), seller);
      expect(out.ok && out.value.payload.stateRegistration).toBeNull();
    });
  });

  it('refuses a document with wrong check digits', () => {
    const out = prepareCustomerRegistration(body({ document: '11.222.333/0001-82' }), seller);
    expect(out).toMatchObject({ ok: false, issues: [{ path: 'document', code: 'invalid_document' }] });
  });

  it('the same content has the same fingerprint, with or without punctuation, and any change alters it', () => {
    const a = prepareCustomerRegistration(body(), seller);
    const b = prepareCustomerRegistration(body({ document: '11222333000181' }), seller);
    const c = prepareCustomerRegistration(body({ name: 'Outro Nome' }), seller);
    const d = prepareCustomerRegistration(body({ clientRequestId: '0198f0a2-7b1c-7c3e-9a55-0123456789ac' }), seller);
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error('expected ok');
    expect(b.value.fingerprint).toBe(a.value.fingerprint);
    expect(c.value.fingerprint).not.toBe(a.value.fingerprint);
    expect(d.value.fingerprint).toBe(a.value.fingerprint);
  });

  describe('owner seller', () => {
    it('a seller owns what they create, even when the body names another seller', () => {
      expect(prepareCustomerRegistration(body({ sellerCode: 9 }), seller)).toMatchObject({ ok: false, issues: [{ code: 'seller_not_linked' }] });
    });

    it('a seller with several links must name one of them', () => {
      const two = { role: 'seller', sellerCodes: [7, 8] } as const;
      expect(prepareCustomerRegistration(body(), two)).toMatchObject({ ok: false, issues: [{ code: 'seller_not_linked' }] });
      const out = prepareCustomerRegistration(body({ sellerCode: 8 }), two);
      expect(out.ok && out.value.payload.sellerCode).toBe(8);
    });

    it('a manager or admin names the seller', () => {
      const out = prepareCustomerRegistration(body({ sellerCode: 12 }), { role: 'manager', sellerCodes: [] });
      expect(out.ok && out.value.payload.sellerCode).toBe(12);
    });

    it('a manager without a linked code and without a named seller is refused, not guessed', () => {
      expect(prepareCustomerRegistration(body(), { role: 'admin', sellerCodes: [] })).toMatchObject({
        ok: false,
        issues: [{ path: 'sellerCode', code: 'seller_required' }],
      });
    });

    it('a manager with exactly one linked code uses it by default', () => {
      const out = prepareCustomerRegistration(body(), { role: 'manager', sellerCodes: [3] });
      expect(out.ok && out.value.payload.sellerCode).toBe(3);
    });
  });
});
