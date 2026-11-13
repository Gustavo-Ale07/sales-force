import type { ConfigurationResponse, ConfigurationSummary, DatasetIdentity, OrderEntryConfiguration, SyncState } from '@salesforce/contracts';
import type { syncState } from '@salesforce/db';
import { discountAuthorityModeOf, eligibleOrderTopCodesOf, sellableNegotiationTypes, type InstallationConfiguration } from '@salesforce/domain';
import { summarizeIntegration } from '../platform/integration-summary.js';
import { isReservedSyncEntity } from '../platform/worker-heartbeat.js';
import type { CurrentConfiguration } from './configuration.service.js';

type SyncStateRow = typeof syncState.$inferSelect;

const SYNC_STATUSES: readonly SyncState['status'][] = ['idle', 'running', 'succeeded', 'failed'];

/**
 * The client-safe view of a snapshot: same structure minus the account e-mail links (personal data
 * of other accounts), reduced to a count. Explicit field list: a field added to the domain type
 * never reaches a client by accident.
 */
export function toConfigurationSummary(configuration: InstallationConfiguration): ConfigurationSummary {
  const { customers } = configuration;
  return {
    schemaVersion: configuration.schemaVersion,
    source: { ...configuration.source },
    general: {
      enabled: configuration.general.enabled,
      enabledCompanyCodes: [...configuration.general.enabledCompanyCodes],
      ...(configuration.general.appMinimumVersion === undefined ? {} : { appMinimumVersion: configuration.general.appMinimumVersion }),
    },
    sales: {
      orderTopCode: configuration.sales.orderTopCode,
      quotationTopCode: configuration.sales.quotationTopCode,
      ...codeListsOf(configuration.sales),
      defaultNegotiationTypeCode: configuration.sales.defaultNegotiationTypeCode,
      negotiationTypes: sellableNegotiationTypes(configuration.sales).map((type) => ({ code: type.code, label: type.label })),
      orderBehavior: {
        allowDraftWithoutPrice: configuration.sales.orderBehavior.allowDraftWithoutPrice,
        ...(configuration.sales.orderBehavior.decimalQuantities === undefined
          ? {}
          : { decimalQuantities: configuration.sales.orderBehavior.decimalQuantities }),
      },
      confirmationBehavior: configuration.sales.confirmationBehavior,
      discountAuthorityMode: discountAuthorityModeOf(configuration.sales.discountAuthority),
    },
    customers: {
      portfolioOwnership: { strategy: customers.portfolioOwnership.strategy },
      customerWithoutPriceTable: customers.customerWithoutPriceTable,
      creditFeatures: { showCreditLimit: customers.creditFeatures.showCreditLimit },
      accountSellerLinkCount: customers.accountSellerLinks.length,
      ...(customers.historyDays === undefined ? {} : { historyDays: customers.historyDays }),
      ...(customers.purchasedWindowDays === undefined ? {} : { purchasedWindowDays: customers.purchasedWindowDays }),
    },
    products: {
      sellableUsageValues: [...configuration.products.sellableUsageValues],
      showInactive: configuration.products.showInactive,
      productWithoutPrice: {
        visible: configuration.products.productWithoutPrice.visible,
        orderable: configuration.products.productWithoutPrice.orderable,
      },
    },
    pricing: toPricingSummary(configuration.pricing),
    financial: { ...configuration.financial },
    features: { ...configuration.features },
    ...(configuration.erp === undefined
      ? {}
      : {
          erp: {
            ...(configuration.erp.orderStatusDisplay === undefined
              ? {}
              : { orderStatusDisplay: configuration.erp.orderStatusDisplay.map((status) => ({ ...status })) }),
            ...(configuration.erp.liberationEventLabels === undefined
              ? {}
              : { liberationEventLabels: { ...configuration.erp.liberationEventLabels } }),
          },
        }),
    ...(configuration.provenance === undefined
      ? {}
      : { provenance: Object.fromEntries(Object.entries(configuration.provenance).map(([key, entry]) => [key, { ...entry }])) }),
  };
}

/**
 * `GET /order-entry/configuration` body: the minimal slice the "Novo pedido" screen reads, open to
 * seller/manager/admin (unlike `/configuration`, admin-only). Extracted directly from the domain
 * configuration — never built from `toConfigurationSummary` — so nothing broader (customers,
 * pricing, financial, sync/integration state) is ever assembled in memory for a non-admin request.
 */
export function toOrderEntryConfiguration(
  configuration: InstallationConfiguration,
  dataset: DatasetIdentity | null,
  erpSubmissionEnabled?: boolean,
  customerCreationEnabled?: boolean,
): OrderEntryConfiguration {
  return {
    dataset: dataset === null ? null : { environment: dataset.environment, datasetId: dataset.datasetId },
    general: {
      enabled: configuration.general.enabled,
      ...(erpSubmissionEnabled === undefined ? {} : { erpSubmissionEnabled }),
      ...(customerCreationEnabled === undefined ? {} : { customerCreationEnabled }),
    },
    sales: {
      defaultNegotiationTypeCode: configuration.sales.defaultNegotiationTypeCode,
      negotiationTypes: sellableNegotiationTypes(configuration.sales).map((type) => ({ code: type.code, label: type.label })),
      orderBehavior: { allowDraftWithoutPrice: configuration.sales.orderBehavior.allowDraftWithoutPrice },
      discountAuthorityMode: discountAuthorityModeOf(configuration.sales.discountAuthority),
      orderTops: {
        defaultTopCode: configuration.sales.orderTopCode,
        quotationTopCode: configuration.sales.quotationTopCode,
        eligibleTopCodes: [...eligibleOrderTopCodesOf(configuration.sales)],
        quoteTopCodes: [...(configuration.sales.quoteTopCodes ?? [])],
      },
    },
    products: {
      productWithoutPrice: { orderable: configuration.products.productWithoutPrice.orderable },
    },
  };
}

function toSyncState(row: SyncStateRow): SyncState {
  const status = (SYNC_STATUSES as readonly string[]).includes(row.status) ? (row.status as SyncState['status']) : 'failed';
  return {
    entity: row.entity,
    status,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastFullReconcileAt: row.lastFullReconcileAt?.toISOString() ?? null,
    rowCount: row.rowCount,
    lastErrorClass: row.lastErrorClass,
    lastErrorMessage: row.lastErrorMessage,
  };
}

/** `GET /configuration` body. Pure: rows and clock are parameters. The sync cursor is never exposed. */
export function buildConfigurationResponse(
  current: CurrentConfiguration,
  rows: readonly SyncStateRow[],
  now: Date,
): ConfigurationResponse {
  const integration = summarizeIntegration(rows, now);
  return {
    contentHash: current.contentHash,
    configuration: toConfigurationSummary(current.configuration),
    syncStates: rows
      .filter((row) => !isReservedSyncEntity(row.entity))
      .map(toSyncState)
      .sort((a, b) => a.entity.localeCompare(b.entity)),
    gateway: { mode: integration.gatewayMode },
    integration,
  };
}

/** The TOP/code lists of the sales section that the read-only settings screen shows (admin/technical only). */
function codeListsOf(sales: InstallationConfiguration['sales']) {
  const lists = {
    eligibleOrderTopCodes: sales.eligibleOrderTopCodes,
    topAllowlist: sales.topAllowlist,
    negotiationTypeExclusions: sales.negotiationTypeExclusions,
    quoteTopCodes: sales.quoteTopCodes,
    skipConfirmationTopCodes: sales.skipConfirmationTopCodes,
  };
  return {
    ...Object.fromEntries(Object.entries(lists).filter(([, value]) => value !== undefined).map(([key, value]) => [key, [...(value ?? [])]])),
    ...(sales.orderStockLocationCode === undefined ? {} : { orderStockLocationCode: sales.orderStockLocationCode }),
  };
}

function toPricingSummary(pricing: InstallationConfiguration['pricing']) {
  const { mobilePriceTableCodes, alternativeTable, ...rest } = pricing;
  return {
    ...rest,
    ...(mobilePriceTableCodes === undefined ? {} : { mobilePriceTableCodes: [...mobilePriceTableCodes] }),
    ...(alternativeTable === undefined ? {} : { alternativeTable: { ...alternativeTable } }),
  };
}
