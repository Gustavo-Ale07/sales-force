import type {
  ConfigurationSourceKind,
  DecimalString,
  InstallationConfiguration,
  ListPrice,
  PriceTable,
  PriceTableVersion,
  Product,
  ProductGroup,
  Seller,
  Customer,
} from '@salesforce/domain';

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
  | 'customers'
  | 'products'
  | 'productGroups'
  | 'priceTables'
  | 'priceTableVersions'
  | 'listPrices';

export const READ_ENTITIES: readonly ReadEntity[] = [
  'configuration',
  'sellers',
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
    /** Intentionally unimplemented until SNK-4 prerequisites V-11 and V-13 close (SNK-5, SNK-6). */
    readonly writes: { readonly submitOrder: 'not_implemented' };
  };
}

export interface ReadOptions {
  readonly signal?: AbortSignal;
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
  /** Ordered by `Seller.code`. */
  readSellers(options?: ReadOptions): Snapshot<Seller>;
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

/**
 * PROVISIONAL shape, declared as a type only. Nothing implements it: SNK-5 (origin-id field not
 * chosen) and SNK-6 (order submission gates: V-11, V-13) are open. Do not build on this shape; it
 * will be revised when the write path is designed.
 */
export interface SubmitOrderRequest {
  /** Sales Force origin id checked before ANY retry (SNK-4). The Sankhya field is not chosen (SNK-5). */
  readonly originId: string;
  readonly customerCode: number;
  readonly sellerCode: number | null;
  readonly items: readonly { readonly productCode: number; readonly quantity: DecimalString }[];
}

export interface SubmitOrderResult {
  /** Identifier assigned by the ERP. Shape provisional. */
  readonly externalOrderId: string;
}

export interface SankhyaWritePort {
  /**
   * INTENTIONALLY UNIMPLEMENTED (SNK-4, SNK-5, SNK-6). Writes go only through `integration_outbox`
   * processed by the worker, after V-11 and V-13 close. Every implementation in this package
   * rejects with `NotImplementedError` without contacting the ERP.
   */
  submitOrder(request: SubmitOrderRequest): Promise<SubmitOrderResult>;
}

export interface SankhyaGateway extends SankhyaReadPort, SankhyaWritePort {
  describe(): GatewayDescription;
}

export const SUBMIT_ORDER_NOT_IMPLEMENTED_MESSAGE =
  'submitOrder is intentionally not implemented: NEEDS VALIDATION V-11 / V-13 (spike §9.39; SNK-4, SNK-5, SNK-6). ' +
  'ERP order writes stay disabled until the write-safety gates close.';
