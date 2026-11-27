import { z } from 'zod';
import { codeInt, named } from './primitives.js';

/**
 * ERP address registry mirrored for the customer registration pickers (cities, neighborhoods, streets). Reference data read by
 * the app/site like carriers and sellers: whole lists, no cost, margin or personal data.
 */

/** A city of the ERP registry (TSICID). `uf` is the 2-letter state; `ibge` is the 7-digit municipality code when the ERP has one. */
export const CitySchema = named(
  'City',
  z.object({ code: codeInt(), name: z.string(), uf: z.string().length(2), ibge: z.string().nullable() }),
);
export type City = z.infer<typeof CitySchema>;
export const CitiesResponseSchema = named('CitiesResponse', z.object({ items: z.array(CitySchema) }));
export type CitiesResponse = z.infer<typeof CitiesResponseSchema>;

/** A customer price table (active and enabled for mobile), listed by name. Reference data: no cost, margin or personal data. */
export const CustomerPriceTableSchema = named('CustomerPriceTable', z.object({ code: codeInt(), name: z.string() }));
export type CustomerPriceTable = z.infer<typeof CustomerPriceTableSchema>;
/** `defaultCode`: the installation default (the Force configuration) when it is one of the listed tables, else null; the screens start the field with it. */
export const CustomerPriceTablesResponseSchema = named(
  'CustomerPriceTablesResponse',
  z.object({ items: z.array(CustomerPriceTableSchema), defaultCode: codeInt().nullable() }),
);
export type CustomerPriceTablesResponse = z.infer<typeof CustomerPriceTablesResponseSchema>;

export const NeighborhoodSchema = named('Neighborhood', z.object({ code: codeInt(), name: z.string() }));
export type Neighborhood = z.infer<typeof NeighborhoodSchema>;
export const NeighborhoodsResponseSchema = named('NeighborhoodsResponse', z.object({ items: z.array(NeighborhoodSchema) }));
export type NeighborhoodsResponse = z.infer<typeof NeighborhoodsResponseSchema>;

/** A street of the ERP registry (TSIEND). `kind` is the street type (RUA, AVENIDA...) when the ERP has one. */
export const StreetSchema = named('Street', z.object({ code: codeInt(), name: z.string(), kind: z.string().nullable() }));
export type Street = z.infer<typeof StreetSchema>;
export const StreetsResponseSchema = named('StreetsResponse', z.object({ items: z.array(StreetSchema) }));
export type StreetsResponse = z.infer<typeof StreetsResponseSchema>;

/* ---------- postal code lookup (CEP) ---------- */

export const PostalCodePathSchema = z.object({ cep: z.string() });

/**
 * Result of a postal-code lookup. A CEP that is invalid or that no source knows is NOT an error: `found` is `false` and every
 * other field is null (the screen just lets the person type the address). Codes (`cityCode`, `neighborhoodCode`, `streetCode`)
 * are present only when the text matched a row of the ERP registry; otherwise the text alone is returned.
 */
export const PostalCodeLookupSchema = named(
  'PostalCodeLookup',
  z.object({
    found: z.boolean(),
    /** 8 digits, unmasked; echoes the request when valid, null when the CEP was not valid. */
    postalCode: z.string().nullable(),
    street: z.string().nullable(),
    neighborhood: z.string().nullable(),
    city: z.string().nullable(),
    uf: z.string().nullable(),
    cityCode: codeInt().nullable(),
    neighborhoodCode: codeInt().nullable(),
    streetCode: codeInt().nullable(),
    /** Who answered: the ERP postal-code table (mirrored TSICEP) first, then ViaCEP, then BrasilAPI; null when not found. */
    source: z.enum(['erp', 'viacep', 'brasilapi']).nullable(),
  }),
);
export type PostalCodeLookup = z.infer<typeof PostalCodeLookupSchema>;
