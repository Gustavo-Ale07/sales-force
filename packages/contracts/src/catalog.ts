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
