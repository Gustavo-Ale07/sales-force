import { CUSTOMER_STATES as DOMAIN_STATES, CUSTOMER_STATE_LABELS } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_STATES,
  CreateCustomerRequestSchema,
  CustomerRegistrationViewSchema,
  CustomerRegistrationsQuerySchema,
  UpdateCustomerResponseSchema,
} from '../src/index.js';

describe('customer states: the contract enum and the domain wording stay aligned', () => {
  it('has the same four states as the domain, each with a label', () => {
    expect([...CUSTOMER_STATES]).toEqual([...DOMAIN_STATES]);
    for (const state of CUSTOMER_STATES) expect(CUSTOMER_STATE_LABELS[state]).toBeTruthy();
  });

  it('the registration view and edit response carry state and its text', () => {
    expect(Object.keys(CustomerRegistrationViewSchema.shape)).toEqual(expect.arrayContaining(['state', 'stateLabel', 'correctsRegistrationId', 'reasonCode', 'reasonMessage']));
    expect(Object.keys(UpdateCustomerResponseSchema.shape)).toEqual(expect.arrayContaining(['state', 'stateLabel']));
  });

  it('the list query defaults the limit and refuses an unknown state', () => {
    expect(CustomerRegistrationsQuerySchema.parse({}).limit).toBe(50);
    expect(CustomerRegistrationsQuerySchema.safeParse({ state: 'rejected' }).success).toBe(false);
    expect(CustomerRegistrationsQuerySchema.safeParse({ state: 'needs_correction', limit: '10' }).success).toBe(true);
  });

  it('a correction names the refused registration by uuid', () => {
    const base = { clientRequestId: '0198f0a2-7b1c-7c3e-9a55-0123456789ab', document: '11222333000181', name: 'TESTE' };
    expect(CreateCustomerRequestSchema.safeParse({ ...base, correctsRegistrationId: '0198f0a2-7b1c-7c3e-9a55-0123456789ac' }).success).toBe(true);
    expect(CreateCustomerRequestSchema.safeParse({ ...base, correctsRegistrationId: 'x' }).success).toBe(false);
  });
});
