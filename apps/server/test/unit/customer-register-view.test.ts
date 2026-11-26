import { randomUUID } from 'node:crypto';
import { CustomerAddressInputSchema, CreateCustomerRequestSchema, MAX_CUSTOMER_CONTACTS, UpdateCustomerRequestSchema } from '@salesforce/contracts';
import { describe, expect, it } from 'vitest';
import { issuesFromZod } from '../../src/http/app-error.js';
import { EDITABLE_CUSTOMER_FIELDS } from '../../src/customers/customer-update-state.js';
import { reasonOfRegistration, refusalText, stateOfRegistration, toRegistrationView } from '../../src/customers/customer-registration-view.js';

describe('state of a registration (the client never sees a transient error as a refusal)', () => {
  it.each([
    ['pending', 'awaiting_send'],
    ['unknown', 'awaiting_send'],
    ['confirmed', 'sent'],
    ['rejected', 'needs_correction'],
  ])('%s is %s', (status, state) => {
    expect(stateOfRegistration(status)).toBe(state);
  });
});

describe('reason of a refusal', () => {
  it('unwraps the adapter sentence and falls back to a generic text', () => {
    expect(refusalText('partner_required_field: The ERP refused the partner: Informe o CEP.')).toBe('O Sankhya recusou o cadastro: Informe o CEP');
    expect(refusalText('timeout: socket hang up')).toContain('Confira os dados');
    expect(refusalText(null)).toContain('Confira os dados');
  });

  it('a duplicate never carries the ERP text; a parked unknown is "review needed", not a refusal', () => {
    const duplicate = reasonOfRegistration('rejected', 'partner_document_duplicate', { status: 'rejected', nextAttemptAt: null, lastErrorMessage: 'x: The ERP refused the partner: de Beltrano.' });
    expect(duplicate?.code).toBe('document_already_registered');
    expect(duplicate?.message).not.toContain('Beltrano');
    expect(reasonOfRegistration('unknown', null, { status: 'unknown', nextAttemptAt: null, lastErrorMessage: null })?.code).toBe('review_needed');
    expect(reasonOfRegistration('unknown', null, { status: 'unknown', nextAttemptAt: new Date(), lastErrorMessage: null })).toBeNull();
    expect(reasonOfRegistration('pending', null, null)).toBeNull();
  });

  it('maps stable rejection codes to reason codes', () => {
    expect(reasonOfRegistration('rejected', 'invalid_command', null)?.code).toBe('invalid_command');
    expect(reasonOfRegistration('rejected', 'partner_invalid', null)?.code).toBe('erp_refused');
  });

  it('builds the view from the stored row', () => {
    const at = new Date('2026-11-23T12:00:00Z');
    const view = toRegistrationView(
      { id: randomUUID(), status: 'confirmed', erpCustomerCode: 12, originKey: 'force:x', taxId: '11222333000181', name: 'N', sellerCode: 3, rejectionCode: null, correctsRegistrationId: null, createdAt: at, updatedAt: at },
      null,
    );
    expect(view).toMatchObject({ state: 'sent', customerCode: 12, reasonCode: null, createdAt: '2026-11-23T12:00:00.000Z' });
  });
});

describe('edit request contract', () => {
  const base = { clientRequestId: randomUUID() };

  it('accepts only the allow-list and names every other key', () => {
    expect(UpdateCustomerRequestSchema.safeParse({ ...base, phone: '11999990000', notes: null }).success).toBe(true);
    for (const field of ['document', 'name', 'sellerCode', 'creditLimit', 'blocked']) {
      const result = UpdateCustomerRequestSchema.safeParse({ ...base, phone: '11999990000', [field]: 'x' });
      expect(result.success, field).toBe(false);
      if (!result.success) expect(issuesFromZod(result.error).map((issue) => issue.path)).toContain(field);
    }
  });

  it('refuses an empty edit and an oversized contact list', () => {
    expect(UpdateCustomerRequestSchema.safeParse(base).success).toBe(false);
    const contacts = Array.from({ length: MAX_CUSTOMER_CONTACTS + 1 }, () => ({ name: 'Ana', role: null, phone: null, email: null }));
    expect(UpdateCustomerRequestSchema.safeParse({ ...base, contacts }).success).toBe(false);
  });

  it('the editable fields are exactly the contract keys other than the idempotency id and the version token', () => {
    const keys = Object.keys((UpdateCustomerRequestSchema as unknown as { shape: Record<string, unknown> }).shape).filter((key) => key !== 'clientRequestId' && key !== 'baseContactVersion');
    expect([...EDITABLE_CUSTOMER_FIELDS].sort()).toEqual(keys.sort());
  });

  it('shares the address rules of the creation (postal code, codes)', () => {
    expect(CustomerAddressInputSchema.safeParse({ streetCode: 1, neighborhoodCode: 1, number: '10', postalCode: 'abc' }).success).toBe(false);
  });

  it('creation accepts a correction pointer only as a UUID', () => {
    const body = { clientRequestId: randomUUID(), document: '11222333000181', name: 'N', stateRegistration: 'ISENTO' };
    expect(CreateCustomerRequestSchema.safeParse({ ...body, correctsRegistrationId: randomUUID() }).success).toBe(true);
    expect(CreateCustomerRequestSchema.safeParse({ ...body, correctsRegistrationId: 'x' }).success).toBe(false);
  });
});

