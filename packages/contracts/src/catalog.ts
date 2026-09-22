import { z } from 'zod';
import {
  DecimalStringSchema,
  MAX_PAGE_SIZE,
  codeInt,
  named,
  paginationQueryShape,
  queryBoolean,
  queryInt,
  querySearch,
} from './primitives.js';

/** `priced`: row with a value above zero. `zero`: explicit zero row. `none`: no row/table/version. */
export const ListPriceStateSchema = named('ListPriceState', z.enum(['priced', 'zero', 'none']));
export type ListPriceState = z.infer<typeof ListPriceStateSchema>;

export const NoPriceReasonSchema = named(
  'NoPriceReason',
  z.enum(['no_resolved_table', 'no_effective_version', 'no_price_row']),
);
export type NoPriceReason = z.infer<typeof NoPriceReasonSchema>;

/**
 * List price of a product in the price context of the request. Missing price is never 0: it is
 * `state: 'none'` with a reason. List price is not the final transactional price (the ERP decides).
 */
export const ListPriceContextSchema = named(
  'ListPriceContext',
  z.discriminatedUnion('state', [
    z.object({
      state: z.literal('priced'),
      unitPrice: DecimalStringSchema,
      tableCode: codeInt(),
      versionId: codeInt(),
      noPriceReason: z.null(),
    }),
    z.object({
      state: z.literal('zero'),
      unitPrice: DecimalStringSchema,
      tableCode: codeInt(),
      versionId: codeInt(),
      noPriceReason: z.null(),
    }),
    z.object({
      state: z.literal('none'),
      unitPrice: z.null(),
      tableCode: codeInt().nullable(),
      versionId: codeInt().nullable(),
      noPriceReason: NoPriceReasonSchema,
    }),
  ]),
);
export type ListPriceContext = z.infer<typeof ListPriceContextSchema>;

/** Which price table the prices of a response were resolved against. */
export const PriceContextSchema = named(
  'PriceContext',
  z.object({
    /** Customer the context was resolved for; `null` = catalog reference table. */
    customerCode: codeInt().nullable(),
    tableCode: codeInt().nullable(),
    tableName: z.string().nullable(),
    source: z.enum(['customer', 'fallback', 'catalog_reference', 'none']),
  }),
);
export type PriceContext = z.infer<typeof PriceContextSchema>;

/* ---------- product groups ---------- */

export const ProductGroupSchema = named(
  'ProductGroup',
  z.object({ code: codeInt(), name: z.string() }),
);
export type ProductGroup = z.infer<typeof ProductGroupSchema>;

export const ProductGroupsResponseSchema = named(
  'ProductGroupsResponse',
  z.object({ items: z.array(ProductGroupSchema) }),
);
export type ProductGroupsResponse = z.infer<typeof ProductGroupsResponseSchema>;

/* ---------- products ---------- */

export const ProductSortSchema = named(
  'ProductSort',
  z.enum(['description', '-description', 'code', '-code']),
);

export const ProductsQuerySchema = z.object({
  search: querySearch().optional(),
  group: queryInt(0).optional(),
  sellable: queryBoolean().optional(),
  priceState: ListPriceStateSchema.optional(),
  /** When present, prices are resolved for this customer's price table; otherwise the catalog reference table. */
  customerCode: queryInt(0).optional(),
  sort: ProductSortSchema.default('description'),
  ...paginationQueryShape,
});
export type ProductsQuery = z.infer<typeof ProductsQuerySchema>;

export const ProductListItemSchema = named(
  'ProductListItem',
  z.object({
    code: codeInt(),
    description: z.string(),
    active: z.boolean(),
    /** Derived from configuration (sellable usage values), never a hard-coded rule. */
    sellable: z.boolean(),
    unit: z.string(),
    brand: z.string().nullable(),
    reference: z.string().nullable(),
    groupCode: codeInt().nullable(),
    groupName: z.string().nullable(),
    listPrice: ListPriceContextSchema,
  }),
);
export type ProductListItem = z.infer<typeof ProductListItemSchema>;

export const ProductsResponseSchema = named(
  'ProductsResponse',
  z.object({
    items: z.array(ProductListItemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    total: z.number().int().min(0),
    priceContext: PriceContextSchema,
  }),
);
export type ProductsResponse = z.infer<typeof ProductsResponseSchema>;

export const ProductPathSchema = z.object({ code: queryInt(0) });

export const ProductDetailQuerySchema = z.object({ customerCode: queryInt(0).optional() });

export const ProductDetailSchema = named(
  'ProductDetail',
  z.object({
    ...ProductListItemSchema.shape,
    /** Raw usage code as mirrored (informational; sellability comes from configuration). */
    usageCode: z.string().nullable(),
    priceContext: PriceContextSchema,
  }),
);
export type ProductDetail = z.infer<typeof ProductDetailSchema>;

/* ---------- product resolution (batch of pasted / imported identifiers) ---------- */

/** Largest value of a PostgreSQL `integer` column: the range of every ERP code (matches the server mirror). */
const PG_INT_MAX = 2_147_483_647;

export const MAX_PRODUCT_RESOLUTION_IDENTIFIERS = 500;
export const MAX_PRODUCT_IDENTIFIER_LENGTH = 40;
/** Candidates returned for an ambiguous identifier (more would only be noise for a picker). */
export const MAX_PRODUCT_RESOLUTION_CANDIDATES = 5;

/** A product code or reference as typed, pasted or imported: trimmed, 1..40 characters, no control characters. */
const ProductIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PRODUCT_IDENTIFIER_LENGTH)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f-\u009f]+$/, 'Control characters are not allowed');

/**
 * `POST /product-resolutions`. A read (nothing is created or changed); it is a POST only because the
 * batch does not fit a query string. Matching is exact and never heuristic: see the route description.
 */
export const ResolveProductsRequestSchema = named(
  'ResolveProductsRequest',
  z.strictObject({
    /** When present, prices are resolved for this customer's price table (within scope); otherwise the catalog reference table. */
    customerCode: z.number().int().min(1).max(PG_INT_MAX).optional(),
    identifiers: z.array(ProductIdentifierSchema).min(1).max(MAX_PRODUCT_RESOLUTION_IDENTIFIERS),
  }),
);
export type ResolveProductsRequest = z.infer<typeof ResolveProductsRequestSchema>;

export const ProductResolutionStatusSchema = named(
  'ProductResolutionStatus',
  z.enum(['found', 'not_found', 'ambiguous']),
);
export type ProductResolutionStatus = z.infer<typeof ProductResolutionStatusSchema>;

/** One answer per request identifier, in request order. `found` carries `product`; `ambiguous` carries 2..5 `candidates`; `not_found` neither. */
export const ProductResolutionItemSchema = named(
  'ProductResolutionItem',
  z
    .object({
      /** The identifier as sent (after trim). */
      identifier: z.string(),
      status: ProductResolutionStatusSchema,
      product: ProductListItemSchema.optional(),
      candidates: z.array(ProductListItemSchema).max(MAX_PRODUCT_RESOLUTION_CANDIDATES).optional(),
    })
    .superRefine((item, ctx) => {
      const problem = (path: string, message: string): void => {
        ctx.addIssue({ code: 'custom', path: [path], message });
      };
      if (item.status === 'found') {
        if (item.product === undefined) problem('product', 'A found identifier carries its product');
        if (item.candidates !== undefined) problem('candidates', 'A found identifier carries no candidates');
      } else if (item.status === 'ambiguous') {
        if (item.candidates === undefined || item.candidates.length < 2) {
          problem('candidates', 'An ambiguous identifier carries 2 to 5 candidates');
        }
        if (item.product !== undefined) problem('product', 'An ambiguous identifier carries no product');
      } else {
        if (item.product !== undefined) problem('product', 'A not_found identifier carries no product');
        if (item.candidates !== undefined) problem('candidates', 'A not_found identifier carries no candidates');
      }
    }),
);
export type ProductResolutionItem = z.infer<typeof ProductResolutionItemSchema>;

export const ResolveProductsResponseSchema = named(
  'ResolveProductsResponse',
  z.object({
    items: z.array(ProductResolutionItemSchema),
    priceContext: PriceContextSchema,
  }),
);
export type ResolveProductsResponse = z.infer<typeof ResolveProductsResponseSchema>;
