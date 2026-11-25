import { z } from 'zod';
import { IsoTimestampSchema, UuidSchema, codeInt, named, sellerCodeInt } from './primitives.js';

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

/**
 * Text hygiene (M-4). Refused, never stripped: C0/C1 controls (`\p{Cc}`, includes tab, newline, carriage return and
 * DEL), Unicode format characters (`\p{Cf}`: bidi override/isolate/marks, zero-width space/joiner, word joiner, BOM,
 * soft hyphen) and the line/paragraph separators U+2028/U+2029. Side effect accepted: an emoji ZWJ sequence is refused
 * (the ERP columns are plain names). `notes` is the only multi-line field and additionally keeps `\n` and `\t`.
 *
 * Owner ruling 2026-11-13: also refused, because they render as blank text yet are neither controls nor format
 * characters, the invisible fillers U+115F and U+1160 (Hangul choseong/jungseong filler), U+3164 (Hangul filler),
 * U+FFA0 (halfwidth Hangul filler) and U+2800 (braille blank).
 * Normalized instead of refused: a non-breaking space (U+00A0) becomes a regular space; in `notes` CRLF becomes LF
 * (text pasted from Windows). A bare CR stays refused.
 */
const NO_HIDDEN_TEXT = /^[^\p{Cc}\p{Cf}\u2028\u2029\u115f\u1160\u3164\uffa0\u2800]*$/u;
const NO_HIDDEN_MULTILINE_TEXT = /^(?:[^\p{Cc}\p{Cf}\u2028\u2029\u115f\u1160\u3164\uffa0\u2800]|[\n\t])*$/u;
const HIDDEN_TEXT_MESSAGE = 'Caracteres de controle, invisíveis ou que alteram a direção do texto não são permitidos.';
// Normalization uses `.overwrite()` (a check, like `.trim()`), never `.transform()`: the schema keeps its string type, its
// limits, its pattern and its defaults in the published OpenAPI document and the generated client types.
const plainSpaces = (value: string) => value.replace(/\u00a0/g, ' ');
const lineFeeds = (value: string) => value.replace(/\r\n/g, '\n');
const text = (max: number) => z.string().overwrite(plainSpaces).trim().min(1).max(max).regex(NO_HIDDEN_TEXT, HIDDEN_TEXT_MESSAGE);
// CRLF -> LF shortens the text, so it runs before the limit (a pasted 4,000-character text with line breaks must fit).
const multilineText = (max: number) =>
  z.string().overwrite(lineFeeds).overwrite(plainSpaces).trim().min(1).max(max).regex(NO_HIDDEN_MULTILINE_TEXT, HIDDEN_TEXT_MESSAGE);

/**
 * The size and shape of each stored field, the single source of the limits: the API validates the request with them
 * and the worker validates the stored command with the same schemas (M-2), so the numbers exist once.
 */
export const CustomerFieldSchemas = {
  name: text(100),
  tradeName: text(100),
  stateRegistration: text(16),
  phone: z.string().trim().regex(/^\d{1,13}$/, 'Telefone: somente dígitos, até 13.'),
  email: z.email().max(80),
  notes: multilineText(4000),
  addressNumber: text(6),
  addressComplement: text(30),
  postalCode: z.string().regex(/^\d{8}$/, 'Expected 8 digits'),
} as const;

/** Street and neighborhood come from the ERP catalogues (V1 never creates them): codes only. */
export const CustomerAddressInputSchema = named(
  'CustomerAddressInput',
  z.strictObject({
    streetCode: codeInt(),
    neighborhoodCode: codeInt(),
    number: CustomerFieldSchemas.addressNumber,
    complement: CustomerFieldSchemas.addressComplement.nullable().default(null),
    postalCode: CustomerFieldSchemas.postalCode,
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
    name: CustomerFieldSchemas.name,
    tradeName: CustomerFieldSchemas.tradeName.nullable().default(null),
    icmsClassification: IcmsClassificationSchema.default('R'),
    stateRegistration: CustomerFieldSchemas.stateRegistration.nullable().default(null),
    phone: CustomerFieldSchemas.phone.nullable().default(null),
    email: CustomerFieldSchemas.email.nullable().default(null),
    notes: CustomerFieldSchemas.notes.nullable().default(null),
    addresses: z.array(CustomerAddressInputSchema).max(MAX_CUSTOMER_ADDRESSES).default([]),
    /** Manager/admin only: the seller that owns the customer. A seller always owns what they create. */
    sellerCode: sellerCodeInt().optional(),
    /**
     * Correction of a refused request ("Precisa de correção"): the registration being corrected. The corrected data is a NEW
     * request (new `clientRequestId`, hence a new ERP origin key); the refused one stays as history and leaves the open list.
     */
    correctsRegistrationId: UuidSchema.optional(),
  }),
);
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;

export const CUSTOMER_REGISTRATION_STATUSES = ['pending', 'confirmed', 'rejected', 'unknown'] as const;
export const CustomerRegistrationStatusSchema = named(
  'CustomerRegistrationStatus',
  z.enum(CUSTOMER_REGISTRATION_STATUSES),
);

/**
 * The state a client shows (names and wording live in packages/domain, `customer-state.ts`). `draft` lives only on the device
 * ("Salvar e sair": no server call); the server answers the other three. awaiting_send = "Aguardando envio" (retried by the
 * server, never unlocked for a transient error); sent = confirmed by the ERP; needs_correction = "Precisa de correção".
 */
export const CUSTOMER_STATES = ['draft', 'awaiting_send', 'sent', 'needs_correction'] as const;
export const CustomerStateSchema = named('CustomerState', z.enum(CUSTOMER_STATES));
export type CustomerState = z.infer<typeof CustomerStateSchema>;

/** Stable reason codes of a refusal; `reasonMessage` carries the readable text (sanitized ERP reason when there is one). */
export const CUSTOMER_REASON_CODES = ['document_already_registered', 'required_field', 'erp_refused', 'invalid_command', 'review_needed'] as const;
export const CustomerReasonCodeSchema = named('CustomerReasonCode', z.enum(CUSTOMER_REASON_CODES));

export const CreateCustomerResponseSchema = named(
  'CreateCustomerResponse',
  z.object({
    registrationId: UuidSchema,
    status: CustomerRegistrationStatusSchema,
    /** Client state (additive): awaiting_send while the ERP has not confirmed, sent once it did. */
    state: CustomerStateSchema,
    /** The real ERP code once confirmed; null while the customer waits for delivery. */
    customerCode: codeInt().nullable(),
    originKey: z.string(),
  }),
);
export type CreateCustomerResponse = z.infer<typeof CreateCustomerResponseSchema>;

/** One registration as its creator (or the manager/admin who reaches its seller) sees it. */
export const CustomerRegistrationViewSchema = named(
  'CustomerRegistrationView',
  z.object({
    registrationId: UuidSchema,
    state: CustomerStateSchema,
    /** The text to print for `state`, from packages/domain (one wording for site and app). */
    stateLabel: z.string(),
    status: CustomerRegistrationStatusSchema,
    customerCode: codeInt().nullable(),
    originKey: z.string(),
    /** Digits only; shown to the creator's scope, never in logs. */
    document: z.string(),
    name: z.string(),
    sellerCode: codeInt().nullable(),
    /** Set only for `needs_correction` (and `review_needed` while awaiting a person). */
    reasonCode: CustomerReasonCodeSchema.nullable(),
    reasonMessage: z.string().nullable(),
    /** The refused registration this one corrects, if any. */
    correctsRegistrationId: UuidSchema.nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  }),
);
export type CustomerRegistrationView = z.infer<typeof CustomerRegistrationViewSchema>;

export const CustomerRegistrationsQuerySchema = z.object({
  /** Filter by client state; absent = every registration that is not superseded by a correction. */
  state: CustomerStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CustomerRegistrationsQuery = z.infer<typeof CustomerRegistrationsQuerySchema>;

export const CustomerRegistrationsResponseSchema = named(
  'CustomerRegistrationsResponse',
  z.object({ items: z.array(CustomerRegistrationViewSchema) }),
);
export type CustomerRegistrationsResponse = z.infer<typeof CustomerRegistrationsResponseSchema>;

export const CustomerRegistrationPathSchema = z.object({ registrationId: UuidSchema });

/* ---------- Edit (D-AP): only phone, e-mail, contacts, addresses and notes ---------- */

/** NEEDS VALIDATION: the ERP column sizes of a contact were not read; these limits are provisional (contacts and addresses are not deliverable until the ERP mapping is validated, S5.2). */
export const CustomerContactInputSchema = named(
  'CustomerContactInput',
  z.strictObject({
    name: text(100),
    role: text(50).nullable().default(null),
    phone: CustomerFieldSchemas.phone.nullable().default(null),
    email: CustomerFieldSchemas.email.nullable().default(null),
  }),
);
export type CustomerContactInput = z.infer<typeof CustomerContactInputSchema>;

export const MAX_CUSTOMER_CONTACTS = 10;

/**
 * The allow-list of the edit: any other key is refused with a 400 that names it (never ignored). A present field REPLACES the
 * stored value (`null` clears phone, e-mail and notes; `contacts` and `addresses` are whole lists); an absent field is untouched.
 */
export const UpdateCustomerRequestSchema = named(
  'UpdateCustomerRequest',
  z
    .strictObject({
      /** Idempotency key, unique per account. */
      clientRequestId: UuidSchema,
      phone: CustomerFieldSchemas.phone.nullable().optional(),
      email: CustomerFieldSchemas.email.nullable().optional(),
      notes: CustomerFieldSchemas.notes.nullable().optional(),
      contacts: z.array(CustomerContactInputSchema).max(MAX_CUSTOMER_CONTACTS).optional(),
      addresses: z.array(CustomerAddressInputSchema).max(MAX_CUSTOMER_ADDRESSES).optional(),
    })
    .refine((value) => ['phone', 'email', 'notes', 'contacts', 'addresses'].some((key) => (value as Record<string, unknown>)[key] !== undefined), {
      message: 'Informe ao menos um campo para alterar.',
    }),
);
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequestSchema>;

export const UpdateCustomerResponseSchema = named(
  'UpdateCustomerResponse',
  z.object({
    updateId: UuidSchema,
    customerCode: codeInt(),
    state: CustomerStateSchema,
    /** The text to print for `state` (packages/domain). */
    stateLabel: z.string(),
    reasonCode: CustomerReasonCodeSchema.nullable(),
    reasonMessage: z.string().nullable(),
    updatedAt: IsoTimestampSchema,
  }),
);
export type UpdateCustomerResponse = z.infer<typeof UpdateCustomerResponseSchema>;
