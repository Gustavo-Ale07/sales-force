import { z } from 'zod';
import {
  DecimalStringSchema,
  IsoTimestampSchema,
  codeInt,
  named,
  paginated,
  paginationQueryShape,
  queryBoolean,
  queryInt,
  querySearch,
} from './primitives.js';

export const CustomerSortSchema = named('CustomerSort', z.enum(['name', '-name', 'code', '-code']));

export const CustomerStatusFilterSchema = named(
  'CustomerStatusFilter',
  z.enum(['active', 'inactive', 'blocked']),
);

export const CustomersQuerySchema = z.object({
  search: querySearch().optional(),
  status: CustomerStatusFilterSchema.optional(),
  sellerCode: queryInt(0).optional(),
  hasPriceTable: queryBoolean().optional(),
  sort: CustomerSortSchema.default('name'),
  ...paginationQueryShape,
});
export type CustomersQuery = z.infer<typeof CustomersQuerySchema>;

export const CustomerListItemSchema = named(
  'CustomerListItem',
  z.object({
    code: codeInt(),
    name: z.string(),
    tradeName: z.string().nullable(),
    document: z.string().nullable(),
    active: z.boolean(),
    /** Blocked flag as mirrored; its business meaning is configuration/rule territory. */
    blocked: z.boolean(),
    sellerCode: codeInt().nullable(),
    sellerName: z.string().nullable(),
    /** `null` = the customer has no price table of its own. */
    priceTableCode: codeInt().nullable(),
  }),
);
export type CustomerListItem = z.infer<typeof CustomerListItemSchema>;

export const CustomersResponseSchema = paginated('CustomersResponse', CustomerListItemSchema);
export type CustomersResponse = z.infer<typeof CustomersResponseSchema>;

export const CustomerPathSchema = z.object({ code: queryInt(0) });

export const CustomerDetailSchema = named(
  'CustomerDetail',
  CustomerListItemSchema.extend({
    priceTableName: z.string().nullable(),
    /** Table that actually applies to this customer per configuration; `null` = no resolved table. */
    resolvedPriceTable: z
      .object({ code: codeInt(), source: z.enum(['customer', 'fallback']) })
      .nullable(),
    /** Only present when the installation configuration enables showing credit limits. */
    creditLimit: DecimalStringSchema.nullable(),
    syncedAt: IsoTimestampSchema,
  }),
);
export type CustomerDetail = z.infer<typeof CustomerDetailSchema>;
