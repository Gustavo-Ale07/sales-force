import type { ConfigurationResponse, ConfigurationSummary, SyncState } from '@salesforce/contracts';
import type { syncState } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
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
    general: { enabled: configuration.general.enabled, enabledCompanyCodes: [...configuration.general.enabledCompanyCodes] },
    sales: {
      orderTopCode: configuration.sales.orderTopCode,
      quotationTopCode: configuration.sales.quotationTopCode,
      defaultNegotiationTypeCode: configuration.sales.defaultNegotiationTypeCode,
      negotiationTypes: configuration.sales.negotiationTypes.map((type) => ({ code: type.code, label: type.label })),
      orderBehavior: { allowDraftWithoutPrice: configuration.sales.orderBehavior.allowDraftWithoutPrice },
      confirmationBehavior: configuration.sales.confirmationBehavior,
    },
    customers: {
      portfolioOwnership: { strategy: customers.portfolioOwnership.strategy },
      customerWithoutPriceTable: customers.customerWithoutPriceTable,
      creditFeatures: { showCreditLimit: customers.creditFeatures.showCreditLimit },
      accountSellerLinkCount: customers.accountSellerLinks.length,
    },
    products: {
      sellableUsageValues: [...configuration.products.sellableUsageValues],
      showInactive: configuration.products.showInactive,
      productWithoutPrice: {
        visible: configuration.products.productWithoutPrice.visible,
        orderable: configuration.products.productWithoutPrice.orderable,
      },
    },
    pricing: { ...configuration.pricing },
    financial: { ...configuration.financial },
    features: { ...configuration.features },
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
