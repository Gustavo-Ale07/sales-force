import { z } from 'zod';
import type { InstallationConfiguration as DomainInstallationConfiguration } from '@salesforce/domain';
import { validateConfigurationConsistency } from '@salesforce/domain';
import { IntegrationSummarySchema, GatewayModeSchema } from './health.js';
import { IsoTimestampSchema, codeInt, named, sellerCodeInt } from './primitives.js';
import type { Assert, DeepMutable, Equals, Mutual } from './type-utils.js';

/**
 * Installation configuration (CFG-1..6). Structured and versioned; nothing here has a default that
 * equals any customer value. Strict objects: unknown keys are rejected everywhere except inside
 * `features`, which is an open record of boolean flags.
 */

export const ConfigurationSourceKindSchema = named(
  'ConfigurationSourceKind',
  z.enum(['sankhya', 'bootstrap-file', 'demo']),
);
export type ConfigurationSourceKind = z.infer<typeof ConfigurationSourceKindSchema>;
export const ConfirmationBehaviorSchema = named(
  'ConfirmationBehavior',
  z.enum(['manual', 'automatic', 'disabled']),
);
export type ConfirmationBehavior = z.infer<typeof ConfirmationBehaviorSchema>;
export const PortfolioOwnershipStrategySchema = named(
  'PortfolioOwnershipStrategy',
  z.enum(['customer_seller_field', 'explicit_account_links', 'all_visible']),
);
export type PortfolioOwnershipStrategy = z.infer<typeof PortfolioOwnershipStrategySchema>;
export const CustomerWithoutPriceTablePolicySchema = named(
  'CustomerWithoutPriceTablePolicy',
  z.enum(['no_resolved_table', 'use_fallback_table']),
);
export type CustomerWithoutPriceTablePolicy = z.infer<typeof CustomerWithoutPriceTablePolicySchema>;
export const FallbackStrategySchema = named('FallbackStrategy', z.enum(['none', 'fixed_table']));
export type FallbackStrategy = z.infer<typeof FallbackStrategySchema>;

export const FieldSupportSchema = named(
  'FieldSupport',
  z.enum(['SUPPORTED', 'READ_ONLY', 'IGNORED_UNTIL_NEEDED']),
);
export const MobilityFilterValidationSchema = named(
  'MobilityFilterValidation',
  z.enum(['pending_validation', 'validated']),
);
export const MobilityFilterModeSchema = named(
  'MobilityFilterMode',
  z.enum(['disabled', 'enforced']),
);
export const AlternativeTableValidationSchema = named(
  'AlternativeTableValidation',
  z.enum(['needs_validation', 'validated']),
);

const FieldSupportMapSchema = z.record(z.string().min(1).max(60), FieldSupportSchema);

export const OrderLayoutConfigurationSchema = named(
  'OrderLayoutConfiguration',
  z.strictObject({
    layoutNumber: codeInt().nullable(),
    fieldSupport: z.strictObject({
      header: FieldSupportMapSchema,
      items: FieldSupportMapSchema,
      unlistedFields: FieldSupportSchema,
    }),
  }),
);

/** `sourceField` is a column NAME later used by the gateway: strictly validated, never free text. */
export const MobilityFilterSchema = named(
  'MobilityFilter',
  z.strictObject({
    sourceField: z.string().regex(/^[A-Z][A-Z0-9_]{0,29}$/),
    allowedValues: z.array(z.string().min(1).max(20)).min(1),
    validation: MobilityFilterValidationSchema,
    mode: MobilityFilterModeSchema,
  }),
);

export const AlternativeTableSchema = named(
  'AlternativeTable',
  z.strictObject({
    tableCode: codeInt(),
    validation: AlternativeTableValidationSchema,
    active: z.boolean(),
  }),
);

const SourceSchema =z.strictObject({
  kind: ConfigurationSourceKindSchema,
  version: z.string().min(1).max(200),
  syncedAt: IsoTimestampSchema,
});

const GeneralSchema = z.strictObject({
  enabled: z.boolean(),
  enabledCompanyCodes: z.array(codeInt()),
  defaultCompanyCode: codeInt().nullable().optional(),
});

export const NegotiationTypeSchema = named(
  'NegotiationType',
  z.strictObject({ code: codeInt(), label: z.string().min(1).max(200) }),
);

/** D-M: `erp` (default) = Sankhya releases discount/credit; `force` = the Force approval flow (DISC-2..6). */
export const DiscountAuthorityModeSchema = named('DiscountAuthorityMode', z.enum(['erp', 'force']));
export type DiscountAuthorityMode = z.infer<typeof DiscountAuthorityModeSchema>;

/** Maximum discount percentage per authority level, on the customer's price-table price (DISC-2). `null` = not configured. */
const DiscountPercentLimitSchema = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).nullable();

const DiscountAuthorityLimitsSchema = z.strictObject({
  seller: DiscountPercentLimitSchema,
  manager: DiscountPercentLimitSchema,
  director: DiscountPercentLimitSchema,
});

/**
 * Three limits per level (DISC-3, Q9), inclusive (Q7); the director limit is the absolute ceiling (Q13).
 * `provisional` = the owner's provisional values, "ajustar pelo dono" (Q11). `userOverrides` is a RESERVED shape
 * (RF-CAT-3, post-pilot, Q8): accepted so that adding it later needs no migration, never evaluated.
 */
export const DiscountAuthorityConfigurationSchema = named(
  'DiscountAuthorityConfiguration',
  z.strictObject({
    mode: DiscountAuthorityModeSchema.optional(),
    limits: DiscountAuthorityLimitsSchema,
    provisional: z.boolean().optional(),
    userOverrides: z
      .array(z.strictObject({ username: z.string().min(1).max(254), limits: DiscountAuthorityLimitsSchema }))
      .max(500)
      .optional(),
  }),
);

const SalesSchema = z.strictObject({
  orderTopCode: codeInt().nullable(),
  eligibleOrderTopCodes: z.array(codeInt()).optional(),
  orderStockLocationCode: codeInt().nullable().optional(),
  orderLayout: OrderLayoutConfigurationSchema.optional(),
  quotationTopCode: codeInt().nullable(),
  defaultNegotiationTypeCode: codeInt().nullable(),
  negotiationTypes: z.array(NegotiationTypeSchema),
  orderBehavior: z.strictObject({ allowDraftWithoutPrice: z.boolean() }),
  confirmationBehavior: ConfirmationBehaviorSchema,
  /** Absent = discount authority not configured: discounts are refused (fail closed). Not sent to clients. */
  discountAuthority: DiscountAuthorityConfigurationSchema.optional(),
});

export const AccountSellerLinkSchema = named(
  'AccountSellerLink',
  z.strictObject({ accountEmail: z.email().max(254), sellerCode: sellerCodeInt() }),
);

const CustomersSchema = z.strictObject({
  portfolioOwnership: z.strictObject({ strategy: PortfolioOwnershipStrategySchema }),
  accountSellerLinks: z.array(AccountSellerLinkSchema),
  customerWithoutPriceTable: CustomerWithoutPriceTablePolicySchema,
  creditFeatures: z.strictObject({ showCreditLimit: z.boolean() }),
});

const ProductsSchema = z.strictObject({
  sellableUsageValues: z.array(z.string().min(1).max(20)),
  showInactive: z.boolean(),
  productWithoutPrice: z.strictObject({ visible: z.boolean(), orderable: z.boolean() }),
  mobilityFilter: MobilityFilterSchema.optional(),
});

const PricingSchema = z.strictObject({
  customerTableStrategy: z.literal('customer_table'),
  fallbackStrategy: FallbackStrategySchema,
  fallbackTableCode: codeInt().nullable(),
  catalogReferenceTableCode: codeInt().nullable(),
  missingPrice: z.literal('no_price_state'),
  mobilePriceTableCodes: z.array(codeInt()).optional(),
  alternativeTable: AlternativeTableSchema.optional(),
});

const FinancialSchema = z.strictObject({
  showFinancialArea: z.boolean(),
  overdueTitles: z.boolean(),
  creditChecks: z.boolean(),
});

/** Open record of feature flags (`demoMetrics` is the only known key today). */
export const FeatureFlagsSchema = named(
  'FeatureFlags',
  z.record(z.string().min(1).max(100), z.boolean()),
);

/** Structure without the cross-field consistency check. */
const InstallationConfigurationShape = z.strictObject({
  schemaVersion: z.literal(1),
  source: SourceSchema,
  general: GeneralSchema,
  sales: SalesSchema,
  customers: CustomersSchema,
  products: ProductsSchema,
  pricing: PricingSchema,
  financial: FinancialSchema,
  features: FeatureFlagsSchema,
});

/**
 * The full snapshot as stored and as loaded from a bootstrap file. It includes account e-mails
 * (`customers.accountSellerLinks`), so it is never sent to clients as-is: see `ConfigurationSummary`.
 * Consistency rules come from `validateConfigurationConsistency` in `@salesforce/domain`.
 */
export const InstallationConfigurationSchema = InstallationConfigurationShape.check((ctx) => {
  const issues = validateConfigurationConsistency(ctx.value as DomainInstallationConfiguration);
  for (const issue of issues) {
    ctx.issues.push({
      code: 'custom',
      message: issue.code,
      path: issue.path.split('.'),
      input: ctx.value,
    });
  }
});
export type InstallationConfiguration = z.infer<typeof InstallationConfigurationSchema>;

/* ---------- compile-time equality with the domain type ---------- */

type DomainMutable = DeepMutable<DomainInstallationConfiguration>;

// Every section except `features` must be exactly equal to the domain type.
export type ConfigurationMatchesDomain = Assert<
  Equals<Omit<DomainMutable, 'features'>, Omit<DeepMutable<InstallationConfiguration>, 'features'>>
>;
// `features` (known keys + open record in the domain) is compared by mutual assignability.
export type FeaturesMatchDomain = Assert<
  Mutual<DomainMutable['features'], InstallationConfiguration['features']>
>;
/** The parsed value can be handed to domain functions directly (compile-time check). */
export const assertAssignableToDomain = (
  c: InstallationConfiguration,
): DomainInstallationConfiguration => c;

/* ---------- client-safe summary (GET /configuration) ---------- */

/**
 * Snapshot summary for clients: the same structure minus account e-mail links (personal data of
 * other accounts), reduced to a count. No secret can exist in the snapshot (P-22).
 */
export const ConfigurationSummarySchema = named(
  'ConfigurationSummary',
  z.object({
    schemaVersion: z.literal(1),
    source: SourceSchema,
    general: GeneralSchema,
    sales: SalesSchema.omit({ discountAuthority: true }).extend({
      /** D-M: web/mobile hide W-39, W-20 and M-14 unless this is `force`. */
      discountAuthorityMode: DiscountAuthorityModeSchema,
    }),
    customers: CustomersSchema.omit({ accountSellerLinks: true }).extend({
      accountSellerLinkCount: z.number().int().min(0),
    }),
    products: ProductsSchema,
    pricing: PricingSchema,
    financial: FinancialSchema,
    features: FeatureFlagsSchema,
  }),
);
export type ConfigurationSummary = z.infer<typeof ConfigurationSummarySchema>;

/**
 * Minimal configuration slice for the order-entry screen ("Novo pedido"): open to every role that
 * can create an order (seller/manager/admin), unlike `/configuration` (admin-only). Explicit field
 * list, extracted directly from the domain configuration — never a slice of `ConfigurationSummary`,
 * so nothing broader (customers, pricing, financial, sync/integration state) is ever assembled for a
 * non-admin request.
 */
/** Shared by the API environment validation and the response contract (one definition, no drift). */
export const ENVIRONMENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const DATASET_ID_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export const DatasetIdentitySchema = named(
  'DatasetIdentity',
  z.strictObject({
    /** ERP environment slug of the installation's data (e.g. `sandbox`). Not a secret. */
    environment: z.string().regex(ENVIRONMENT_SLUG_PATTERN),
    /** Logical dataset id; bumped whenever the dataset changes (fake to real, new mirror source, sandbox to production). */
    datasetId: z.string().regex(DATASET_ID_SLUG_PATTERN),
  }),
);
export type DatasetIdentity = z.infer<typeof DatasetIdentitySchema>;

export const OrderEntryConfigurationSchema = named(
  'OrderEntryConfiguration',
  z.object({
    /** Explicit installation dataset identity (`null` while the installation does not declare one). */
    dataset: DatasetIdentitySchema.nullable(),
    general: z.strictObject({ enabled: z.boolean() }),
    sales: z.strictObject({
      defaultNegotiationTypeCode: codeInt().nullable(),
      negotiationTypes: z.array(NegotiationTypeSchema),
      orderBehavior: z.strictObject({ allowDraftWithoutPrice: z.boolean() }),
      /** D-M: `erp` = discounts above the allowed are released in Sankhya after sending; no approval UI. */
      discountAuthorityMode: DiscountAuthorityModeSchema,
    }),
    products: z.strictObject({
      productWithoutPrice: z.strictObject({ orderable: z.boolean() }),
    }),
  }),
);
export type OrderEntryConfiguration = z.infer<typeof OrderEntryConfigurationSchema>;

export const SyncStatusSchema = named(
  'SyncStatus',
  z.enum(['idle', 'running', 'succeeded', 'failed']),
);

/** Per-entity mirror synchronization state. The internal cursor is never exposed. */
export const SyncStateSchema = named(
  'SyncState',
  z.object({
    entity: z.string().min(1).max(100),
    status: SyncStatusSchema,
    lastSuccessAt: IsoTimestampSchema.nullable(),
    lastAttemptAt: IsoTimestampSchema.nullable(),
    lastFullReconcileAt: IsoTimestampSchema.nullable(),
    rowCount: z.number().int().min(0).nullable(),
    lastErrorClass: z.string().nullable(),
    /** Sanitized, user-safe text. Never a stack trace, credential or raw ERP payload. */
    lastErrorMessage: z.string().nullable(),
  }),
);
export type SyncState = z.infer<typeof SyncStateSchema>;

export const ConfigurationResponseSchema = named(
  'ConfigurationResponse',
  z.object({
    /** Content hash of the current snapshot; `null` while nothing has been stored yet. */
    contentHash: z.string().nullable(),
    configuration: ConfigurationSummarySchema,
    syncStates: z.array(SyncStateSchema),
    gateway: z.object({ mode: GatewayModeSchema }),
    integration: IntegrationSummarySchema,
  }),
);
export type ConfigurationResponse = z.infer<typeof ConfigurationResponseSchema>;
