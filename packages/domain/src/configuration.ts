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
  };
  readonly sales: {
    readonly orderTopCode: number | null;
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
  };
  readonly pricing: {
    readonly customerTableStrategy: 'customer_table';
    readonly fallbackStrategy: FallbackStrategy;
    readonly fallbackTableCode: number | null;
    readonly catalogReferenceTableCode: number | null;
    readonly missingPrice: 'no_price_state';
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
    | 'duplicate_account_seller_link';
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
  return issues;
}
