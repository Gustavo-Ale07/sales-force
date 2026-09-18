import { z } from 'zod';
import type { InstallationConfiguration as DomainInstallationConfiguration } from '@salesforce/domain';
import { validateConfigurationConsistency } from '@salesforce/domain';
import { IntegrationSummarySchema, GatewayModeSchema } from './health.js';
import { IsoTimestampSchema, codeInt, named } from './primitives.js';
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

const SourceSchema = z.strictObject({
  kind: ConfigurationSourceKindSchema,
  version: z.string().min(1).max(200),
  syncedAt: IsoTimestampSchema,
});

const GeneralSchema = z.strictObject({
  enabled: z.boolean(),
  enabledCompanyCodes: z.array(codeInt()),
});

export const NegotiationTypeSchema = named(
  'NegotiationType',
  z.strictObject({ code: codeInt(), label: z.string().min(1).max(200) }),
);

const SalesSchema = z.strictObject({
  orderTopCode: codeInt().nullable(),
  quotationTopCode: codeInt().nullable(),
  defaultNegotiationTypeCode: codeInt().nullable(),
  negotiationTypes: z.array(NegotiationTypeSchema),
  orderBehavior: z.strictObject({ allowDraftWithoutPrice: z.boolean() }),
  confirmationBehavior: ConfirmationBehaviorSchema,
});

export const AccountSellerLinkSchema = named(
  'AccountSellerLink',
  z.strictObject({ accountEmail: z.email().max(254), sellerCode: codeInt() }),
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
});

const PricingSchema = z.strictObject({
  customerTableStrategy: z.literal('customer_table'),
  fallbackStrategy: FallbackStrategySchema,
  fallbackTableCode: codeInt().nullable(),
  catalogReferenceTableCode: codeInt().nullable(),
  missingPrice: z.literal('no_price_state'),
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
    sales: SalesSchema,
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
