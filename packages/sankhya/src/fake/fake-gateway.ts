import type { InstallationConfiguration } from '@salesforce/domain';
import { SankhyaGatewayError } from '../errors.js';
import {
  assertBytesOptions,
  assertSignaturesOptions,
  mediaChangedDuringRead,
  mediaFingerprintOfBytes,
  type ProductMediaSignature,
  type ReadProductMediaBytesOptions,
  type ReadProductMediaSignaturesOptions,
} from '../media.js';
import {
  READ_ENTITIES,
  type GatewayDescription,
  type ReadEntity,
  type ReadOptions,
  type SankhyaGateway,
  type Snapshot,
} from '../gateway.js';
import type {
  ErpOrderRef,
  IncludeOrderResult,
  OrderCallOptions,
  OrderWriteRequest,
  WrittenOrder,
  ErpOrderStatusReading,
} from '../write/order-contract.js';
import { FakeOrderBook } from './fake-order-book.js';
import { assertSafeScope, selectEffectiveVersions } from '../read-scope.js';
import { DEMO_CONFIGURATION } from './demo-configuration.js';
import type { ConfigurationFacts } from '../configuration-facts.js';
import { PLAC_CONFIGURATION_FACTS } from './configuration-facts-fixture.js';
import { getDemoDataset, type DemoDataset } from './demo-data.js';

export interface FakeGatewayFault {
  readonly entity: ReadEntity;
  /** Number of batches delivered before the failure is raised (0 = fail before the first batch). */
  readonly afterBatches: number;
  readonly error: SankhyaGatewayError;
}

export interface FakeGatewayOptions {
  /** Rows per batch; default 100. Small values exercise consumers' multi-batch handling. */
  readonly batchSize?: number;
  /** Dataset to serve; defaults to the frozen synthetic demo dataset. */
  readonly dataset?: DemoDataset;
  readonly configuration?: InstallationConfiguration;
  /** Raw Sankhya-side configuration facts (CFG-8); defaults to the PLAC code fixture. */
  readonly configurationFacts?: ConfigurationFacts;
  /** Injected failures, to test consumers against incomplete snapshots and error classes. */
  readonly faults?: readonly FakeGatewayFault[];
  /** Synthetic product photos and their failure injection (default: no photos). */
  readonly media?: FakeGatewayMediaOptions;
  /** In-memory ERP order tables with scripted outcomes (SNK-7); a private empty book by default. */
  readonly orders?: FakeOrderBook;
}

const DEFAULT_BATCH_SIZE = 100;

export interface FakeGatewayMediaOptions {
  /**
   * Image bytes per product code. The Map is read LIVE, so a test may mutate it between calls to
   * simulate an image that changed. Codes that are not products of the dataset are ignored; empty
   * bytes mean "no photo" (like the ERP).
   */
  readonly images?: ReadonlyMap<number, Uint8Array>;
  /** Per-product failure raised by readProductMediaBytes for that product. */
  readonly failures?: ReadonlyMap<number, SankhyaGatewayError>;
  /** When true both media reads reject with a retryable unavailable error. */
  readonly unavailable?: boolean;
}

/**
 * Deterministic in-memory gateway serving SYNTHETIC data. Used in development, CI and the demo
 * installation (SNK-3): it never opens a network connection and has no credentials.
 */
export class FakeGateway implements SankhyaGateway {
  readonly #batchSize: number;
  readonly #dataset: DemoDataset;
  readonly #configuration: InstallationConfiguration;
  readonly #configurationFacts: ConfigurationFacts;
  readonly #faults: readonly FakeGatewayFault[];
  readonly #media: FakeGatewayMediaOptions;
  readonly #orders: FakeOrderBook;

  constructor(options: FakeGatewayOptions = {}) {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError('batchSize must be a positive integer');
    }
    this.#batchSize = batchSize;
    this.#dataset = options.dataset ?? getDemoDataset();
    this.#configuration = options.configuration ?? DEMO_CONFIGURATION;
    this.#configurationFacts = options.configurationFacts ?? PLAC_CONFIGURATION_FACTS;
    this.#faults = options.faults ?? [];
    this.#media = options.media ?? {};
    this.#orders = options.orders ?? new FakeOrderBook();
  }

  describe(): GatewayDescription {
    const reads = Object.fromEntries(READ_ENTITIES.map((entity) => [entity, 'supported'])) as GatewayDescription['capabilities']['reads'];
    return {
      mode: 'fake',
      environmentKind: 'demo',
      host: null,
      capabilities: {
        reads,
        configurationSource: this.#configuration.source.kind,
        readMechanism: 'fixtures',
        writes: { submitOrder: 'simulated' },
      },
    };
  }

  async readConfiguration(options?: ReadOptions): Promise<InstallationConfiguration> {
    options?.signal?.throwIfAborted();
    this.#failIfFaulted('configuration', 0);
    return this.#configuration;
  }

  async readConfigurationFacts(options?: ReadOptions): Promise<ConfigurationFacts> {
    options?.signal?.throwIfAborted();
    this.#failIfFaulted('configuration', 0);
    return this.#configurationFacts;
  }

  readSellers(options?: ReadOptions) {
    return this.#snapshot('sellers', this.#dataset.sellers, options);
  }
  readCarriers(options?: ReadOptions) {
    return this.#snapshot('carriers', this.#dataset.carriers, options);
  }
  readDirectoryUsers(options?: ReadOptions) {
    return this.#snapshot('directoryUsers', this.#dataset.directoryUsers, options);
  }
  readCustomers(options?: ReadOptions) {
    return this.#snapshot('customers', this.#dataset.customers, options);
  }
  readProducts(options?: ReadOptions) {
    assertSafeScope(options?.scope);
    const filter = options?.scope?.products;
    const rows =
      filter === undefined
        ? this.#dataset.products
        : this.#dataset.products.filter(
            (p) => (filter.activeOnly === false || p.active) && p.usageCode !== null && filter.usageValues.includes(p.usageCode),
          );
    return this.#snapshot('products', rows, options);
  }
  readProductGroups(options?: ReadOptions) {
    return this.#snapshot('productGroups', this.#dataset.productGroups, options);
  }
  readPriceTables(options?: ReadOptions) {
    assertSafeScope(options?.scope);
    const codes = options?.scope?.priceTableCodes;
    const rows = codes === undefined ? this.#dataset.priceTables : this.#dataset.priceTables.filter((t) => codes.includes(t.code));
    return this.#snapshot('priceTables', rows, options);
  }
  readPriceTableVersions(options?: ReadOptions) {
    return this.#snapshot('priceTableVersions', this.#versions(options), options);
  }
  readListPrices(options?: ReadOptions) {
    const scoped = options?.scope?.priceTableCodes !== undefined;
    const ids = new Set(this.#versions(options).map((v) => v.versionId));
    const rows = scoped ? this.#dataset.listPrices.filter((p) => ids.has(p.versionId)) : this.#dataset.listPrices;
    return this.#snapshot('listPrices', rows, options);
  }

  async readProductMediaSignatures(options: ReadProductMediaSignaturesOptions): Promise<readonly ProductMediaSignature[]> {
    const after = assertSignaturesOptions(options);
    assertSafeScope(options.scope);
    options.signal?.throwIfAborted();
    this.#failIfMediaUnavailable();
    const filter = options.scope?.products;
    const images = this.#media.images;
    if (images === undefined) return [];
    return this.#dataset.products
      .filter(
        (p) =>
          p.code > after &&
          (filter === undefined ||
            ((filter.activeOnly === false || p.active) && p.usageCode !== null && filter.usageValues.includes(p.usageCode))),
      )
      .flatMap((p) => {
        const bytes = images.get(p.code);
        return bytes !== undefined && bytes.length > 0
          ? [{ productCode: p.code, byteLength: bytes.length, fingerprint: mediaFingerprintOfBytes(bytes) }]
          : [];
      })
      .sort((a, b) => a.productCode - b.productCode)
      .slice(0, options.limit);
  }

  async readProductMediaBytes(options: ReadProductMediaBytesOptions): Promise<Uint8Array> {
    assertBytesOptions(options);
    options.signal?.throwIfAborted();
    this.#failIfMediaUnavailable();
    const failure = this.#media.failures?.get(options.productCode);
    if (failure !== undefined) throw failure;
    const bytes = this.#media.images?.get(options.productCode);
    if (bytes === undefined || bytes.length !== options.expectedLength) {
      throw mediaChangedDuringRead(options.productCode, 'length differs from the announced one');
    }
    return Uint8Array.from(bytes);
  }

  #failIfMediaUnavailable(): void {
    if (this.#media.unavailable === true) {
      throw new SankhyaGatewayError('unavailable', { code: 'fake_unavailable', message: 'Synthetic ERP outage (fake gateway).' });
    }
  }

  /** Same rule as the real gateway: configured tables only, current version per table plus future ones. */
  #versions(options?: ReadOptions) {
    assertSafeScope(options?.scope);
    const codes = options?.scope?.priceTableCodes;
    if (codes === undefined) return this.#dataset.priceTableVersions;
    const inScope = this.#dataset.priceTableVersions.filter((v) => codes.includes(v.tableCode));
    return selectEffectiveVersions(inScope, options?.scope?.now ?? new Date().toISOString());
  }

  // ---- order delivery (SNK-7): in-memory, no network, scripted outcomes ----------------------

  includeOrder(request: OrderWriteRequest, options?: OrderCallOptions): Promise<IncludeOrderResult> {
    return this.#order(options, () => this.#orders.include(request));
  }

  confirmOrder(erpOrderNumber: number, options?: OrderCallOptions): Promise<void> {
    return this.#order(options, () => this.#orders.confirm(erpOrderNumber));
  }

  findOrderByOrigin(originField: string, originId: string, options?: OrderCallOptions): Promise<ErpOrderRef | null> {
    void originField;
    return this.#order(options, () => this.#orders.find(originId));
  }

  readOrderStatusFacts(erpOrderNumbers: readonly number[], options?: OrderCallOptions): Promise<readonly ErpOrderStatusReading[]> {
    return this.#order(options, () => this.#orders.statusOf(erpOrderNumbers));
  }

  readWrittenOrder(erpOrderNumber: number, options?: OrderCallOptions): Promise<WrittenOrder | null> {
    return this.#order(options, () => this.#orders.read(erpOrderNumber));
  }

  #order<T>(options: OrderCallOptions | undefined, action: () => T): Promise<T> {
    try {
      options?.signal?.throwIfAborted();
      return Promise.resolve(action());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #failIfFaulted(entity: ReadEntity, deliveredBatches: number): void {
    const fault = this.#faults.find((f) => f.entity === entity && f.afterBatches === deliveredBatches);
    if (fault) throw fault.error;
  }

  #snapshot<T>(entity: ReadEntity, rows: readonly T[], options?: ReadOptions): Snapshot<T> {
    const batchSize = this.#batchSize;
    const failIfFaulted = (delivered: number) => this.#failIfFaulted(entity, delivered);
    return {
      async *[Symbol.asyncIterator]() {
        let delivered = 0;
        failIfFaulted(delivered);
        for (let offset = 0; offset < rows.length; offset += batchSize) {
          options?.signal?.throwIfAborted();
          yield rows.slice(offset, offset + batchSize);
          delivered += 1;
          failIfFaulted(delivered);
        }
      },
    };
  }
}
