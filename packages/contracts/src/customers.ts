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
    /**
     * Read-only financial hint (D-I): the customer has at least one overdue title. Only ever `true` when the installation shows
     * the financial area and overdue titles; absent/false otherwise. Information only: it never blocks a sale.
     */
    overdue: z.boolean().optional(),
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
    /** Monthly credit limit as reported by the ERP; same flag as `creditLimit`; `null` = not shown or not reported. */
    monthlyCreditLimit: DecimalStringSchema.nullable(),
    syncedAt: IsoTimestampSchema,
  }),
);
export type CustomerDetail = z.infer<typeof CustomerDetailSchema>;

const DueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CustomerFinancialTitleSchema = named(
  'CustomerFinancialTitle',
  z.object({
    nufin: codeInt(),
    /** Sales document number the title came from, when any. */
    documentNumber: codeInt().nullable(),
    dueDate: DueDateSchema,
    amount: DecimalStringSchema,
    /** Amount still open (amount - already paid). */
    balance: DecimalStringSchema,
    /** Due date before today (America/Sao_Paulo); always `false` when the installation does not show overdue titles. */
    overdue: z.boolean(),
  }),
);
export type CustomerFinancialTitle = z.infer<typeof CustomerFinancialTitleSchema>;

export const CustomerFinancialSummarySchema = z.object({
  openCount: z.number().int().nonnegative(),
  openAmount: DecimalStringSchema,
  /** `null` when the installation does not show overdue titles. */
  overdueCount: z.number().int().nonnegative().nullable(),
  overdueAmount: DecimalStringSchema.nullable(),
  oldestOverdueDueDate: DueDateSchema.nullable(),
});

/**
 * Read-only financial information of one customer (D-I): mirrored from the ERP, never blocks a sale. Credit limits only when the
 * installation shows them (`customers.creditFeatures.showCreditLimit`).
 */
export const CustomerFinancialSchema = named(
  'CustomerFinancial',
  z.object({
    customerCode: codeInt(),
    creditLimit: DecimalStringSchema.nullable(),
    monthlyCreditLimit: DecimalStringSchema.nullable(),
    blocked: z.boolean(),
    blockReason: z.string().nullable(),
    situation: z.string().nullable(),
    summary: CustomerFinancialSummarySchema,
    titles: z.array(CustomerFinancialTitleSchema),
    /** When the ERP information was last read (latest title sync, else the customer sync). */
    checkedAt: IsoTimestampSchema,
  }),
);
export type CustomerFinancial = z.infer<typeof CustomerFinancialSchema>;
