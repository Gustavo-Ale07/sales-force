import type { SankhyaOrderReadPort, SankhyaWritePort } from './write/order-contract.js';
import type {
  ConfigurationSourceKind,
  InstallationConfiguration,
  ListPrice,
  PriceTable,
  PriceTableVersion,
  Product,
  ProductGroup,
  Seller,
  Customer,
  DirectoryUser,
  Carrier,
  IpiRate,
  OpenTitle,
} from '@salesforce/domain';
import type { SankhyaProductMediaPort } from './media.js';
import type { ReadScope } from './read-scope.js';
import type { ConfigurationFacts } from './configuration-facts.js';
import type { SalesHistoryCustomerProductRow, SalesHistoryMonthlyRow, SalesHistoryReadOptions } from './sales-history.js';

/**
 * `SankhyaGateway`: the ERP boundary (P-02, P-03, STACK-2). Inputs and outputs are Sales Force-shaped
 * domain types only; no ERP table, column or service name crosses this interface. Only the worker
 * calls it. The fake and the real adapter satisfy the same contract (`test/support/gateway-contract.ts`).
 */

export type SankhyaMode = 'fake' | 'live';
export type EnvironmentKind = 'demo' | 'sandbox' | 'homologation' | 'production';

export type ReadEntity =
  | 'configuration'
  | 'sellers'
  | 'directoryUsers'
  | 'carriers'
  | 'ipiRates'
  | 'openTitles'
  | 'salesHistoryMonthly'
  | 'salesHistoryCustomerProduct'
  | 'customers'
  | 'products'
  | 'productGroups'
  | 'priceTables'
  | 'priceTableVersions'
  | 'listPrices';

export const READ_ENTITIES: readonly ReadEntity[] = [
  'configuration',
  'sellers',
  'directoryUsers',
  'carriers',
  'ipiRates',
  'openTitles',
  'salesHistoryMonthly',
  'salesHistoryCustomerProduct',
  'customers',
  'products',
  'productGroups',
  'priceTables',
  'priceTableVersions',
  'listPrices',
];

/** `not_implemented` means the read raises `NotImplementedError` (NEEDS VALIDATION in the spike doc). */
export type CapabilityStatus = 'supported' | 'not_implemented';

export interface GatewayDescription {
  readonly mode: SankhyaMode;
  readonly environmentKind: EnvironmentKind;
  /** Host the adapter talks to (never credentials); `null` for the fake. */
  readonly host: string | null;
  readonly capabilities: {
    readonly reads: Readonly<Record<ReadEntity, CapabilityStatus>>;
    /** Where `readConfiguration()` gets its snapshot from; `null` = not available (U-10). */
    readonly configurationSource: ConfigurationSourceKind | null;
    readonly readMechanism: 'fixtures' | 'sql_ordered_paging';
    /**
     * `not_implemented` = no write path active (default; SNK-4 prerequisites V-11/V-13 open);
     * `sandbox_only` = real adapter in live write mode, Sandbox hosts only; `simulated` = the fake.
     */
    readonly writes: { readonly submitOrder: 'not_implemented' | 'sandbox_only' | 'simulated' };
  };
}

export interface ReadOptions {
  readonly signal?: AbortSignal;
  /** Installation-derived limits (see ReadScope); omitted = no limits beyond placeholder exclusion. */
  readonly scope?: ReadScope;
  /** Called for a row the adapter dropped on its own (message never carries a value); the rest of the page is kept. */
  readonly onWarning?: (message: string) => void;
  /**
   * D-V: called once when a customer/carrier snapshot ends, with how many rows each eligibility criterion left out
   * (criterion name -> count; empty when none). Counts only, never values.
   */
  readonly onExcluded?: (entity: ReadEntity, countsByCriterion: Readonly<Record<string, number>>) => void;
}

/**
 * A full snapshot delivered as batches. Contract:
 * - batches are non-empty; their concatenation is the whole entity, ordered ascending by the full
 *   primary key (see each read), with no duplicate key;
 * - a snapshot is COMPLETE only when the iteration finishes without throwing. Any failure (including
 *   a failed completeness check) surfaces as a thrown `SankhyaGatewayError` at the point it is
 *   detected, possibly after earlier batches were yielded. Consumers must therefore stage the data
 *   and must never delete or deactivate mirror rows for keys "absent" from an unfinished iteration
 *   (spike §9.33 item 3).
 */
export type Snapshot<T> = AsyncIterable<readonly T[]>;

export interface SankhyaReadPort {
  /** One complete, self-consistent configuration snapshot (not paged). */
  readConfiguration(options?: ReadOptions): Promise<InstallationConfiguration>;
  /**
   * RAW FACTS of the Vidya configuration kept inside Sankhya (CFG-8, spike §9.49): typed rows per query
   * Q1-Q8 with per-query success/failure. The server overlays them on the base file; the gateway maps
   * nothing into the configuration snapshot. Classified error for auth/unavailable/rate-limit; other
   * failures are per-query markers (`assertConfigurationFactsComplete` throws on any).
   * (Named `...Facts` because `readConfiguration` already returns the bootstrap snapshot.)
   */
  readConfigurationFacts(options?: ReadOptions): Promise<ConfigurationFacts>;
  /** Ordered by `Seller.code`. */
  readSellers(options?: ReadOptions): Snapshot<Seller>;
  /** Ordered by `DirectoryUser.code`. Only the user code and its official seller relation: never names, e-mails or credentials. */
  readDirectoryUsers(options?: ReadOptions): Snapshot<DirectoryUser>;
  /** Ordered by `Carrier.code`. Partners flagged as carriers: code, name and active flag only. */
  readCarriers(options?: ReadOptions): Snapshot<Carrier>;
  /** Ordered by `IpiRate.code`. IPI rates (TGFIPI) for the display estimate; read in full on every run. */
  readIpiRates(options?: ReadOptions): Snapshot<IpiRate>;
  /** Ordered by `OpenTitle.nufin`. Open receivable titles (read-only financial information, D-I); a complete snapshot every run. */
  readOpenTitles(options?: ReadOptions): Snapshot<OpenTitle>;
  /**
   * Ordered by `(customerCode, sellerCode, month, topCode)`. Sales-history aggregate per customer x seller x month x TOP
   * (SUM of the note value, aggregated by the ERP query). TOPs, statuses, date field and window come from `options.config`
   * (installation configuration, never literals). A complete snapshot every run; read-only.
   */
  readSalesHistoryMonthly(options: SalesHistoryReadOptions): Snapshot<SalesHistoryMonthlyRow>;
  /** Ordered by `(customerCode, productCode, topCode)`. Sales-history aggregate per customer x product x TOP; same configuration as above. */
  readSalesHistoryCustomerProduct(options: SalesHistoryReadOptions): Snapshot<SalesHistoryCustomerProductRow>;
  /** Ordered by `Customer.code`. */
  readCustomers(options?: ReadOptions): Snapshot<Customer>;
  /** Ordered by `Product.code`. */
  readProducts(options?: ReadOptions): Snapshot<Product>;
  /** Ordered by `ProductGroup.code`. */
  readProductGroups(options?: ReadOptions): Snapshot<ProductGroup>;
  /** Ordered by `PriceTable.code`. */
  readPriceTables(options?: ReadOptions): Snapshot<PriceTable>;
  /** Ordered by `PriceTableVersion.versionId`. Every stored version, superseded ones included (F-39). */
  readPriceTableVersions(options?: ReadOptions): Snapshot<PriceTableVersion>;
  /**
   * Ordered by `(versionId, productCode)`. Only rows that EXIST in the ERP are returned: a product
   * with no row has no price (`none`), an explicit zero row is returned with `unitPrice` `"0"`.
   * Missing is never converted to zero (§9.35, F-42).
   */
  readListPrices(options?: ReadOptions): Snapshot<ListPrice>;
}

export interface SankhyaGateway extends SankhyaReadPort, SankhyaProductMediaPort, SankhyaWritePort, SankhyaOrderReadPort {
  describe(): GatewayDescription;
}

/**
 * Why order writes refuse (SNK-4, SNK-5, SNK-6): the real adapter writes only when the worker
 * configuration is `live` against the Sandbox; otherwise it raises `NotImplementedError` without any
 * network call.
 */
export const ORDER_WRITE_NOT_ENABLED_MESSAGE =
  'ERP order writes are not enabled for this gateway: NEEDS VALIDATION V-11 / V-13 (spike §9.39; SNK-4, SNK-5, SNK-6). ' +
  'They require SANKHYA_ORDER_WRITE_MODE=live against the Sandbox with the gates marker.';
