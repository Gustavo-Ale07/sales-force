import type { InstallationConfiguration } from '@salesforce/domain';
import { NotImplementedError, type SankhyaGatewayError } from '../errors.js';
import {
  READ_ENTITIES,
  SUBMIT_ORDER_NOT_IMPLEMENTED_MESSAGE,
  type GatewayDescription,
  type ReadEntity,
  type ReadOptions,
  type SankhyaGateway,
  type Snapshot,
  type SubmitOrderRequest,
  type SubmitOrderResult,
} from '../gateway.js';
import { DEMO_CONFIGURATION } from './demo-configuration.js';
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
  /** Injected failures, to test consumers against incomplete snapshots and error classes. */
  readonly faults?: readonly FakeGatewayFault[];
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * Deterministic in-memory gateway serving SYNTHETIC data. Used in development, CI and the demo
 * installation (SNK-3): it never opens a network connection and has no credentials.
 */
export class FakeGateway implements SankhyaGateway {
  readonly #batchSize: number;
  readonly #dataset: DemoDataset;
  readonly #configuration: InstallationConfiguration;
  readonly #faults: readonly FakeGatewayFault[];

  constructor(options: FakeGatewayOptions = {}) {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError('batchSize must be a positive integer');
    }
    this.#batchSize = batchSize;
    this.#dataset = options.dataset ?? getDemoDataset();
    this.#configuration = options.configuration ?? DEMO_CONFIGURATION;
    this.#faults = options.faults ?? [];
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
        writes: { submitOrder: 'not_implemented' },
      },
    };
  }

  async readConfiguration(options?: ReadOptions): Promise<InstallationConfiguration> {
    options?.signal?.throwIfAborted();
    this.#failIfFaulted('configuration', 0);
    return this.#configuration;
  }

  readSellers(options?: ReadOptions) {
    return this.#snapshot('sellers', this.#dataset.sellers, options);
  }
  readCustomers(options?: ReadOptions) {
    return this.#snapshot('customers', this.#dataset.customers, options);
  }
  readProducts(options?: ReadOptions) {
    return this.#snapshot('products', this.#dataset.products, options);
  }
  readProductGroups(options?: ReadOptions) {
    return this.#snapshot('productGroups', this.#dataset.productGroups, options);
  }
  readPriceTables(options?: ReadOptions) {
    return this.#snapshot('priceTables', this.#dataset.priceTables, options);
  }
  readPriceTableVersions(options?: ReadOptions) {
    return this.#snapshot('priceTableVersions', this.#dataset.priceTableVersions, options);
  }
  readListPrices(options?: ReadOptions) {
    return this.#snapshot('listPrices', this.#dataset.listPrices, options);
  }

  /** SNK-4 / SNK-5 / SNK-6: intentionally unimplemented, no side effect. */
  submitOrder(request: SubmitOrderRequest): Promise<SubmitOrderResult> {
    void request;
    return Promise.reject(new NotImplementedError(SUBMIT_ORDER_NOT_IMPLEMENTED_MESSAGE));
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
