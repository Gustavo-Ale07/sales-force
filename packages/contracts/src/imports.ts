import { z } from 'zod';
import { DatasetIdentitySchema } from './configuration.js';
import { UuidSchema, codeInt, named, queryInt, querySearch } from './primitives.js';

/**
 * Spreadsheet import and export (RF-IMP-1/2/3/5, RF-DSH-6). Limits are checked on the server BEFORE the file is parsed.
 * The export routes exist for the internal profiles only: the external representative has no grant (default deny).
 */

export const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 50_000;
/** Base64 text of a file at the size limit, plus the JSON envelope. */
export const IMPORT_MAX_BODY_BYTES = Math.ceil((IMPORT_MAX_FILE_BYTES * 4) / 3) + 16 * 1024;
/** One confirm creates at most this many customers: the account's hourly creation budget (30) and CEP lookups (30/min) bound it anyway. */
export const IMPORT_MAX_CUSTOMER_ROWS = 30;
export const IMPORT_MAX_REPORTED_ERRORS = 1000;
export const IMPORT_PREVIEW_ROWS = 50;

export const IMPORT_TYPES = ['order_items', 'customers'] as const;
export const ImportTypeSchema = named('ImportType', z.enum(IMPORT_TYPES));
export type ImportType = z.infer<typeof ImportTypeSchema>;

/** Field id -> the file column (header text) it is read from. A field not listed (or null) is not read. */
export const ImportMappingSchema = named('ImportMapping', z.record(z.string().max(40), z.string().max(200).nullable()));
export type ImportMapping = z.infer<typeof ImportMappingSchema>;

const importFileFields = {
  type: ImportTypeSchema,
  fileName: z.string().trim().min(1).max(255),
  /** The file, base64-encoded (`.xlsx` or `.csv`, up to 20 MiB decoded). */
  contentBase64: z.string().min(1).max(Math.ceil((IMPORT_MAX_FILE_BYTES * 4) / 3) + 8),
  /** Required for `order_items`: the customer the quotation is for. */
  customerCode: codeInt().optional(),
  mapping: ImportMappingSchema.optional(),
};

export const ImportPreviewRequestSchema = named('ImportPreviewRequest', z.strictObject(importFileFields));
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequestSchema>;

export const ImportConfirmRequestSchema = named(
  'ImportConfirmRequest',
  z.strictObject({
    ...importFileFields,
    /** One per user action: a replay of the same confirm creates nothing twice. */
    clientRequestId: UuidSchema,
    /** Required for `order_items` (same trust boundary as `POST /orders`). */
    expectedDataset: DatasetIdentitySchema.optional(),
  }),
);
export type ImportConfirmRequest = z.infer<typeof ImportConfirmRequestSchema>;

export const ImportFieldSchema = named(
  'ImportField',
  z.object({ id: z.string(), label: z.string(), required: z.boolean() }),
);

export const ImportRowIssueSchema = named('ImportRowIssue', z.object({ row: z.number().int().min(1), reason: z.string() }));
export type ImportRowIssue = z.infer<typeof ImportRowIssueSchema>;

export const ImportPreviewRowSchema = named(
  'ImportPreviewRow',
  z.object({
    row: z.number().int().min(1),
    ok: z.boolean(),
    /** Recognised row: what it becomes (product line, or customer name). */
    label: z.string().nullable(),
    quantity: z.string().nullable(),
    reason: z.string().nullable(),
  }),
);

export const ImportPreviewSchema = named(
  'ImportPreview',
  z.object({
    type: ImportTypeSchema,
    fields: z.array(ImportFieldSchema),
    headers: z.array(z.string()),
    /** The mapping in force (suggested by header name when the request sent none). */
    mapping: ImportMappingSchema,
    /** Required fields with no column: the file cannot be confirmed until they are mapped. */
    missingRequired: z.array(z.string()),
    totalRows: z.number().int(),
    recognized: z.number().int(),
    rejected: z.number().int(),
    /** Product rows with an empty quantity (the template lines the customer left blank): ignored, not errors. */
    skippedBlank: z.number().int(),
    sample: z.array(ImportPreviewRowSchema),
    errors: z.array(ImportRowIssueSchema),
    /** True when more errors exist than `errors` carries. */
    errorsTruncated: z.boolean(),
  }),
);
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

export const ImportResultSchema = named(
  'ImportResult',
  z.object({
    type: ImportTypeSchema,
    /** `order_items`: lines placed on the quotation; `customers`: customers recorded. */
    created: z.number().int(),
    rejected: z.number().int(),
    /** Customers recorded but not yet confirmed by the ERP. */
    pending: z.number().int(),
    skippedBlank: z.number().int(),
    orderId: UuidSchema.nullable(),
    draftNumber: z.number().int().nullable(),
    errors: z.array(ImportRowIssueSchema),
    errorsTruncated: z.boolean(),
  }),
);
export type ImportResult = z.infer<typeof ImportResultSchema>;

/* ---------- export ---------- */

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export const ExportFormatSchema = named('ExportFormat', z.enum(EXPORT_FORMATS));
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export const EXPORT_MAX_ROWS = 50_000;

export const ExportCustomersQuerySchema = z.object({
  format: ExportFormatSchema.default('xlsx'),
  search: querySearch().optional(),
  sellerCode: queryInt(0).optional(),
});
export type ExportCustomersQuery = z.infer<typeof ExportCustomersQuerySchema>;

export const ExportOrdersQuerySchema = z.object({
  format: ExportFormatSchema.default('xlsx'),
  search: querySearch().optional(),
  customerCode: queryInt(0).optional(),
});
export type ExportOrdersQuery = z.infer<typeof ExportOrdersQuerySchema>;

export const ExportProductsQuerySchema = z.object({
  format: ExportFormatSchema.default('xlsx'),
  search: querySearch().optional(),
  group: queryInt(0).optional(),
});
export type ExportProductsQuery = z.infer<typeof ExportProductsQuerySchema>;

export const EXPORT_CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
