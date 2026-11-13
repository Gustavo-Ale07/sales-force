import { z } from 'zod';
import { UuidSchema, codeInt, named, sellerCodeInt } from './primitives.js';

/**
 * Customer creation in the Force (D-AR). The customer is written to the ERP by the worker through
 * `integration_outbox`; the API only records the request and waits a bounded time for the confirmation.
 * Limits below are the ERP column sizes read in the Sandbox (owner, 2026-11-13; see docs/implementation/customer-write-plan.md):
 * name and trade name 100, document 14 digits, state registration 16, e-mail 80, phone 13 digits, postal code 8 digits,
 * street number 6, complement 30, notes 4000. Over the limit is refused with a message, never cut.
 */

/** CLASSIFICMS values the seller may pick (docs/implementation/customer-write-plan.md). `R` is the default. */
export const ICMS_CLASSIFICATIONS = ['C', 'I', 'P', 'R', 'T', 'X'] as const;
export const IcmsClassificationSchema = named('IcmsClassification', z.enum(ICMS_CLASSIFICATIONS));
export type IcmsClassification = z.infer<typeof IcmsClassificationSchema>;

export const MAX_CUSTOMER_ADDRESSES = 3;

// eslint-disable-next-line no-control-regex
const noControl = /^[^\u0000-\u001f\u007f-\u009f]*$/;
const text = (max: number) => z.string().trim().min(1).max(max).regex(noControl, 'Control characters are not allowed');

/** Street and neighborhood come from the ERP catalogues (V1 never creates them): codes only. */
export const CustomerAddressInputSchema = named(
  'CustomerAddressInput',
  z.strictObject({
    streetCode: codeInt(),
    neighborhoodCode: codeInt(),
    number: text(6),
    complement: text(30).nullable().default(null),
    postalCode: z.string().regex(/^\d{8}$/, 'Expected 8 digits'),
  }),
);
export type CustomerAddressInput = z.infer<typeof CustomerAddressInputSchema>;

/** Any key outside this list is rejected, never ignored (credit limit, price table, status... are not the seller's to send). */
export const CreateCustomerRequestSchema = named(
  'CreateCustomerRequest',
  z.strictObject({
    /** Idempotency key, unique per account. Its origin key `force:<id>` is what the ERP stores (SNK-4/SNK-5). */
    clientRequestId: UuidSchema,
    /** CPF or CNPJ, with or without punctuation; validity is checked by the domain. */
    document: z.string().trim().min(11).max(18).refine((value) => value.replace(/\D/g, '').length <= 14, 'O CPF/CNPJ deve ter no máximo 14 dígitos.'),
    name: text(100),
    tradeName: text(100).nullable().default(null),
    icmsClassification: IcmsClassificationSchema.default('R'),
    stateRegistration: text(16).nullable().default(null),
    phone: z.string().trim().regex(/^\d{1,13}$/, 'Telefone: somente dígitos, até 13.').nullable().default(null),
    email: z.email().max(80).nullable().default(null),
    notes: text(4000).nullable().default(null),
    addresses: z.array(CustomerAddressInputSchema).max(MAX_CUSTOMER_ADDRESSES).default([]),
    /** Manager/admin only: the seller that owns the customer. A seller always owns what they create. */
    sellerCode: sellerCodeInt().optional(),
  }),
);
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;

export const CUSTOMER_REGISTRATION_STATUSES = ['pending', 'confirmed', 'rejected', 'unknown'] as const;
export const CustomerRegistrationStatusSchema = named(
  'CustomerRegistrationStatus',
  z.enum(CUSTOMER_REGISTRATION_STATUSES),
);

export const CreateCustomerResponseSchema = named(
  'CreateCustomerResponse',
  z.object({
    registrationId: UuidSchema,
    status: CustomerRegistrationStatusSchema,
    /** The real ERP code once confirmed; null while the customer waits for delivery. */
    customerCode: codeInt().nullable(),
    originKey: z.string(),
  }),
);
export type CreateCustomerResponse = z.infer<typeof CreateCustomerResponseSchema>;
