import type { IsoTimestamp } from './entities.js';

/**
 * Installation configuration (CFG-1..6): structured, typed, versioned. Customer-specific commercial
 * values live here as data; no default equals any customer's value. The unconfigured state is
 * conservative (see `defaultUnconfiguredConfiguration`).
 */

export type ConfigurationSourceKind = 'sankhya' | 'bootstrap-file' | 'demo';
export type ConfirmationBehavior = 'manual' | 'automatic' | 'disabled';
export type PortfolioOwnershipStrategy =
  | 'customer_seller_field'
  | 'explicit_account_links'
  | 'all_visible';
export type CustomerWithoutPriceTablePolicy = 'no_resolved_table' | 'use_fallback_table';
export type FallbackStrategy = 'none' | 'fixed_table';
/** How Force treats a field of the native ERP order layout; unknown fields follow `unlistedFields`. */
export type FieldSupport = 'SUPPORTED' | 'READ_ONLY' | 'IGNORED_UNTIL_NEEDED';
export type MobilityFilterValidation = 'pending_validation' | 'validated';
export type MobilityFilterMode = 'disabled' | 'enforced';
export type AlternativeTableValidation = 'needs_validation' | 'validated';

export interface OrderLayoutConfiguration {
  readonly layoutNumber: number | null;
  readonly fieldSupport: {
    readonly header: Readonly<Record<string, FieldSupport>>;
    readonly items: Readonly<Record<string, FieldSupport>>;
    readonly unlistedFields: FieldSupport;
  };
}

/** Restricts the mirrored catalog by a product column. `sourceField` is a column NAME. */
export interface MobilityFilter {
  readonly sourceField: string;
  readonly allowedValues: readonly string[];
  readonly validation: MobilityFilterValidation;
  readonly mode: MobilityFilterMode;
}

export interface AlternativeTable {
  readonly tableCode: number;
  readonly validation: AlternativeTableValidation;
  readonly active: boolean;
}

export interface NegotiationType {
  readonly code: number;
  readonly label: string;
}

export interface AccountSellerLink {
  readonly accountEmail: string;
  readonly sellerCode: number;
}

/** Known feature flags; unknown keys are allowed (open record). */
export const KNOWN_FEATURE_FLAGS = ['demoMetrics'] as const;
export type KnownFeatureFlag = (typeof KNOWN_FEATURE_FLAGS)[number];

export interface InstallationConfiguration {
  readonly schemaVersion: 1;
  readonly source: {
    readonly kind: ConfigurationSourceKind;
    readonly version: string;
    readonly syncedAt: IsoTimestamp;
  };
  readonly general: {
    readonly enabled: boolean;
    readonly enabledCompanyCodes: readonly number[];
    /** Absent/null = not configured. When set it must be one of `enabledCompanyCodes`. */
    readonly defaultCompanyCode?: number | null;
  };
  readonly sales: {
    /** The default order TOP. When `eligibleOrderTopCodes` is present it must be one of them. */
    readonly orderTopCode: number | null;
    readonly eligibleOrderTopCodes?: readonly number[];
    readonly orderStockLocationCode?: number | null;
    readonly orderLayout?: OrderLayoutConfiguration;
    readonly quotationTopCode: number | null;
    readonly defaultNegotiationTypeCode: number | null;
    readonly negotiationTypes: readonly NegotiationType[];
    readonly orderBehavior: {
      readonly allowDraftWithoutPrice: boolean;
    };
    readonly confirmationBehavior: ConfirmationBehavior;
  };
  readonly customers: {
    readonly portfolioOwnership: { readonly strategy: PortfolioOwnershipStrategy };
    /** CFG-2, PROPOSED shape (U-10). */
    readonly accountSellerLinks: readonly AccountSellerLink[];
    readonly customerWithoutPriceTable: CustomerWithoutPriceTablePolicy;
    readonly creditFeatures: { readonly showCreditLimit: boolean };
  };
  readonly products: {
    /** Raw usage codes that make an active product sellable. Empty = nothing is sellable. */
    readonly sellableUsageValues: readonly string[];
    readonly showInactive: boolean;
    readonly productWithoutPrice: { readonly visible: boolean; readonly orderable: boolean };
    /** Absent = no filter. `mode: 'enforced'` requires `validation: 'validated'`. */
    readonly mobilityFilter?: MobilityFilter;
  };
  readonly pricing: {
    readonly customerTableStrategy: 'customer_table';
    readonly fallbackStrategy: FallbackStrategy;
    readonly fallbackTableCode: number | null;
    readonly catalogReferenceTableCode: number | null;
    readonly missingPrice: 'no_price_state';
    /** Price tables the mirror reads. Absent = not configured. */
    readonly mobilePriceTableCodes?: readonly number[];
    /** Never used as a fallback by the domain; `active` requires `validation: 'validated'`. */
    readonly alternativeTable?: AlternativeTable;
  };
  readonly financial: {
    readonly showFinancialArea: boolean;
    readonly overdueTitles: boolean;
    readonly creditChecks: boolean;
  };
  readonly features: Readonly<Partial<Record<KnownFeatureFlag, boolean>> & Record<string, boolean>>;
}

/**
 * Conservative state used before any configuration exists: the installation is disabled, nothing
 * is sellable, nothing without a price is orderable, no fallback price table, no company enabled.
 */
export function defaultUnconfiguredConfiguration(): InstallationConfiguration {
  return {
    schemaVersion: 1,
    source: {
      kind: 'bootstrap-file',
      version: 'unconfigured',
      syncedAt: '1970-01-01T00:00:00.000Z',
    },
    general: { enabled: false, enabledCompanyCodes: [] },
    sales: {
      orderTopCode: null,
      quotationTopCode: null,
      defaultNegotiationTypeCode: null,
      negotiationTypes: [],
      orderBehavior: { allowDraftWithoutPrice: false },
      confirmationBehavior: 'disabled',
    },
    customers: {
      portfolioOwnership: { strategy: 'explicit_account_links' },
      accountSellerLinks: [],
      customerWithoutPriceTable: 'no_resolved_table',
      creditFeatures: { showCreditLimit: false },
    },
    products: {
      sellableUsageValues: [],
      showInactive: false,
      productWithoutPrice: { visible: false, orderable: false },
    },
    pricing: {
      customerTableStrategy: 'customer_table',
      fallbackStrategy: 'none',
      fallbackTableCode: null,
      catalogReferenceTableCode: null,
      missingPrice: 'no_price_state',
    },
    financial: { showFinancialArea: false, overdueTitles: false, creditChecks: false },
    features: {},
  };
}

export interface ConfigurationIssue {
  readonly code:
    | 'fallback_table_required'
    | 'fallback_table_unexpected'
    | 'default_negotiation_type_unknown'
    | 'duplicate_negotiation_type'
    | 'duplicate_account_seller_link'
    | 'order_top_not_eligible'
    | 'duplicate_eligible_order_top'
    | 'default_company_not_enabled'
    | 'mobility_filter_enforced_unvalidated'
    | 'duplicate_mobile_price_table'
    | 'fallback_table_not_mobile'
    | 'catalog_reference_table_not_mobile'
    | 'alternative_table_active_unvalidated';
  readonly path: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Internal-consistency checks of a configuration snapshot. Empty list = consistent. */
export function validateConfigurationConsistency(
  config: InstallationConfiguration,
): ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];
  const { pricing, sales, customers } = config;

  if (pricing.fallbackStrategy === 'fixed_table' && pricing.fallbackTableCode === null) {
    issues.push({ code: 'fallback_table_required', path: 'pricing.fallbackTableCode' });
  }
  if (pricing.fallbackStrategy === 'none' && pricing.fallbackTableCode !== null) {
    issues.push({ code: 'fallback_table_unexpected', path: 'pricing.fallbackTableCode' });
  }

  const codes = sales.negotiationTypes.map((t) => t.code);
  if (new Set(codes).size !== codes.length) {
    issues.push({ code: 'duplicate_negotiation_type', path: 'sales.negotiationTypes' });
  }
  if (
    sales.defaultNegotiationTypeCode !== null &&
    !codes.includes(sales.defaultNegotiationTypeCode)
  ) {
    issues.push({
      code: 'default_negotiation_type_unknown',
      path: 'sales.defaultNegotiationTypeCode',
    });
  }

  const linkKeys = customers.accountSellerLinks.map(
    (l) => `${normalizeEmail(l.accountEmail)}|${l.sellerCode}`,
  );
  if (new Set(linkKeys).size !== linkKeys.length) {
    issues.push({ code: 'duplicate_account_seller_link', path: 'customers.accountSellerLinks' });
  }

  const eligible = sales.eligibleOrderTopCodes;
  if (eligible !== undefined) {
    if (new Set(eligible).size !== eligible.length) {
      issues.push({ code: 'duplicate_eligible_order_top', path: 'sales.eligibleOrderTopCodes' });
    }
    if (sales.orderTopCode !== null && !eligible.includes(sales.orderTopCode)) {
      issues.push({ code: 'order_top_not_eligible', path: 'sales.orderTopCode' });
    }
  }

  const defaultCompany = config.general.defaultCompanyCode;
  if (
    defaultCompany !== undefined &&
    defaultCompany !== null &&
    !config.general.enabledCompanyCodes.includes(defaultCompany)
  ) {
    issues.push({ code: 'default_company_not_enabled', path: 'general.defaultCompanyCode' });
  }

  const filter = config.products.mobilityFilter;
  if (filter !== undefined && filter.mode === 'enforced' && filter.validation !== 'validated') {
    issues.push({
      code: 'mobility_filter_enforced_unvalidated',
      path: 'products.mobilityFilter.mode',
    });
  }

  const mobileTables = pricing.mobilePriceTableCodes;
  if (mobileTables !== undefined) {
    if (new Set(mobileTables).size !== mobileTables.length) {
      issues.push({ code: 'duplicate_mobile_price_table', path: 'pricing.mobilePriceTableCodes' });
    }
    if (pricing.fallbackTableCode !== null && !mobileTables.includes(pricing.fallbackTableCode)) {
      issues.push({ code: 'fallback_table_not_mobile', path: 'pricing.fallbackTableCode' });
    }
    if (
      pricing.catalogReferenceTableCode !== null &&
      !mobileTables.includes(pricing.catalogReferenceTableCode)
    ) {
      issues.push({
        code: 'catalog_reference_table_not_mobile',
        path: 'pricing.catalogReferenceTableCode',
      });
    }
  }

  const alt = pricing.alternativeTable;
  if (alt !== undefined && alt.active && alt.validation !== 'validated') {
    issues.push({
      code: 'alternative_table_active_unvalidated',
      path: 'pricing.alternativeTable.active',
    });
  }
  return issues;
}
