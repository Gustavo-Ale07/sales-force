import { z } from 'zod';
import { named } from './primitives.js';

/* ---------- company lookup (CNPJ) ---------- */

export const CnpjPathSchema = z.object({ cnpj: z.string() });

/**
 * Result of a CNPJ lookup. An invalid, unknown or unreachable CNPJ is NOT an error: `found` is `false` and every other field is
 * null (the registration just stays free). Address text is matched afterwards by the client through the postal-code lookup.
 */
export const CnpjLookupSchema = named(
  'CnpjLookup',
  z.object({
    found: z.boolean(),
    cnpj: z.string().nullable(),
    legalName: z.string().nullable(),
    tradeName: z.string().nullable(),
    /** 8 digits, unmasked. */
    postalCode: z.string().nullable(),
    street: z.string().nullable(),
    number: z.string().nullable(),
    complement: z.string().nullable(),
    neighborhood: z.string().nullable(),
    city: z.string().nullable(),
    uf: z.string().nullable(),
    /** Digits with area code (10 or 11). */
    phone: z.string().nullable(),
    email: z.string().nullable(),
    source: z.enum(['brasilapi', 'cnpjws']).nullable(),
  }),
);
export type CnpjLookup = z.infer<typeof CnpjLookupSchema>;
