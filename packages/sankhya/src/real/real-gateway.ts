import type {
  Carrier,
  Customer,
  InstallationConfiguration,
  ListPrice,
  PriceTable,
  PriceTableVersion,
  Product,
  ProductGroup,
} from '@salesforce/domain';
import { assertSafeScope, selectEffectiveVersions, type ReadScope } from '../read-scope.js';

/** D-V: columns of TGFPAR in the connected schema (names only). */
const CUSTOMER_COLUMN_DISCOVERY_SQL = "SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TGFPAR'";
import {
  MEDIA_CHUNK_BYTES,
  assertBytesOptions,
  assertSignaturesOptions,
  mediaChangedDuringRead,
  mediaFingerprint,
  mediaSampleOffsets,
  mediaSampleWidth,
  type ProductMediaSignature,
  type ReadProductMediaBytesOptions,
  type ReadProductMediaSignaturesOptions,
} from '../media.js';
import {
  UnavailableConfigurationSource,
  type ConfigurationSource,
} from '../configuration-source.js';
import {
  NotImplementedError,
  AmbiguousOriginError,
  SankhyaGatewayError,
  classifyHttpFailure,
  parseRetryAfterMs,
} from '../errors.js';
import {
  READ_ENTITIES,
  type EnvironmentKind,
  type GatewayDescription,
  type ReadOptions,
  type SankhyaGateway,
  type Snapshot,
  ORDER_WRITE_NOT_ENABLED_MESSAGE,
} from '../gateway.js';
import { decimalFromCell } from '../decimal.js';
import { ORDER_WRITE_DISABLED, isValidOriginField, type OrderWriteSettings } from '../write/order-write-config.js';
import { assertSandboxHost } from '../write/host-allowlist.js';
import { INCLUIR_NOTA_PATH, buildIncluirNotaRequestText, parseIncluirNotaResponse } from '../write/incluir-nota.js';
import type {
  ErpOrderRef,
  IncludeOrderResult,
  OrderCallOptions,
  OrderWriteRequest,
  WrittenOrder,
  ErpOrderStatusReading,
  WrittenOrderItem,
} from '../write/order-contract.js';
import { assertBaseUrlAllowed, assertRequestUrlAllowed } from './host-guard.js';
import type { ConfigQueryResult, ConfigurationFacts, GeneralParametersRow } from '../configuration-facts.js';
import {
  CONFIG_QUERIES,
  Q1_COLUMN_DISCOVERY_COLUMNS,
  Q1_COLUMN_DISCOVERY_SQL,
  buildQ1,
  type ConfigQueryDef,
} from './configuration-queries.js';
import {
  CUSTOMER_SPEC,
  customerSpec,
  PRODUCT_GROUP_SPEC,
  listPriceSpec,
  priceTableSpec,
  priceTableVersionSpec,
  PRODUCT_MEDIA_CHUNK_COLUMNS,
  PRODUCT_MEDIA_LENGTH_COLUMNS,
  PRODUCT_MEDIA_SIGNATURE_COLUMNS,
  productMediaChunkSql,
  productMediaLengthSql,
  productMediaSignaturesSql,
  productSpec,
  RowReader,
  SELLER_SPEC,
  DIRECTORY_USER_SPEC,
  carrierSpec,
  IPI_RATE_SPEC,
  OPEN_TITLE_SPEC,
  compareKeys,
  isRowDiscard,
  type EntitySpec,
} from './mapping.js';
import { TokenProvider, type SankhyaCredentials } from './token-provider.js';
import type { HttpResponse, HttpTransport } from './transport.js';

export const DEFAULT_PAGE_SIZE = 500;
/** Largest page size measured (F-23: 500 and 1,000). The 5,000-row silent cap (F-19) stays far away. */
export const MAX_PAGE_SIZE = 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** CACSP.incluirNota runs the ERP's own business rules and can take longer than a read (live Sandbox, 2026-11-09: timeouts at 30 s). Writes only; reads keep `DEFAULT_REQUEST_TIMEOUT_MS`. */
export const DEFAULT_INCLUDE_TIMEOUT_MS = 120_000;
/** Sandbox DB clock is UTC-03:00 (F-39). Production NEEDS VALIDATION; override per installation. */
export const DEFAULT_DB_UTC_OFFSET_MINUTES = -180;

const GATEWAY_PATH = '/gateway/v1/mge/service.sbr';
const QUERY_SERVICE = 'DbExplorerSP.executeQuery';

export interface RealSankhyaGatewayOptions {
  readonly baseUrl: string;
  /** Exact hosts this installation may call; no default (SNK-3). Re-checked on every request. */
  readonly allowedHosts: readonly string[];
  readonly environmentKind: Exclude<EnvironmentKind, 'demo'>;
  readonly credentials: SankhyaCredentials;
  readonly transport: HttpTransport;
  /** Injected clock, ms since epoch. */
  readonly now?: () => number;
  readonly pageSize?: number;
  readonly requestTimeoutMs?: number;
  /** Timeout of the order write (`includeOrder`) only; default `DEFAULT_INCLUDE_TIMEOUT_MS`. */
  readonly includeTimeoutMs?: number;
  readonly dbUtcOffsetMinutes?: number;
  /** Bootstrap file source for `readConfiguration()`; without it the read raises `NotImplementedError` (U-10). */
  readonly configurationSource?: ConfigurationSource;
  /** SNK-7 D-1; absent = writes disabled. Only `live` (Sandbox, validated by the factory) can write. */
  readonly orderWrite?: OrderWriteSettings;
}

/**
 * Read-only ERP adapter (P-02, P-03, STACK-2). Live use is opt-in (`createGateway`), credentials come
 * from the worker environment, and its only write path is `includeOrder`, active solely in the
 * `live` order-write mode against the Sandbox (SNK-7; SNK-4, SNK-5, SNK-6); otherwise it rejects
 * without any HTTP call.
 *
 * Reads use `DbExplorerSP.executeQuery` with `ORDER BY <full key>` + `OFFSET ... FETCH` (F-23, F-30;
 * VALIDATED (env) in the Sandbox, Oracle dialect F-19). Requests are serialized (limits unmeasured,
 * S0.2). Snapshot completeness is verified with a row count and strictly increasing keys; a mismatch
 * is a retryable `temporary` error (data may have changed between pages), never silent.
 * NOT implemented (NEEDS VALIDATION): installation configuration from Sankhya (U-10), derived-table
 * percentages (S2.3), CODTABALT, submitOrder.
 */
export class RealSankhyaGateway implements SankhyaGateway {
  readonly #origin: string;
  readonly #host: string;
  readonly #allowedHosts: readonly string[];
  readonly #environmentKind: Exclude<EnvironmentKind, 'demo'>;
  readonly #transport: HttpTransport;
  readonly #tokens: TokenProvider;
  readonly #pageSize: number;
  readonly #requestTimeoutMs: number;
  readonly #includeTimeoutMs: number;
  readonly #dbUtcOffsetMinutes: number;
  readonly #configurationSource: ConfigurationSource;
  readonly #now: () => number;
  readonly #orderWrite: OrderWriteSettings;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RealSankhyaGatewayOptions) {
    const checked = assertBaseUrlAllowed(options.baseUrl, options.allowedHosts);
    this.#origin = checked.origin;
    this.#host = checked.host;
    this.#allowedHosts = options.allowedHosts;
    this.#environmentKind = options.environmentKind;
    this.#transport = options.transport;
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(this.#pageSize) || this.#pageSize < 1 || this.#pageSize > MAX_PAGE_SIZE) {
      throw new RangeError(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
    }
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#includeTimeoutMs = options.includeTimeoutMs ?? DEFAULT_INCLUDE_TIMEOUT_MS;
    this.#dbUtcOffsetMinutes = options.dbUtcOffsetMinutes ?? DEFAULT_DB_UTC_OFFSET_MINUTES;
    this.#configurationSource = options.configurationSource ?? new UnavailableConfigurationSource();
    this.#now = options.now ?? Date.now;
    this.#orderWrite = options.orderWrite ?? ORDER_WRITE_DISABLED;
    this.#tokens = new TokenProvider({
      origin: this.#origin,
      credentials: options.credentials,
      transport: options.transport,
      now: options.now ?? Date.now,
      requestTimeoutMs: this.#requestTimeoutMs,
    });
  }

  describe(): GatewayDescription {
    const reads = Object.fromEntries(
      READ_ENTITIES.map((entity) => {
        const supported =
          entity === 'configuration' ? !(this.#configurationSource instanceof UnavailableConfigurationSource) : true;
        return [entity, supported ? 'supported' : 'not_implemented'];
      }),
    ) as GatewayDescription['capabilities']['reads'];
    return {
      mode: 'live',
      environmentKind: this.#environmentKind,
      host: this.#host,
      capabilities: {
        reads,
        configurationSource: this.#configurationSource instanceof UnavailableConfigurationSource ? null : this.#configurationSource.kind,
        readMechanism: 'sql_ordered_paging',
        writes: { submitOrder: this.#orderWrite.mode === 'live' ? 'sandbox_only' : 'not_implemented' },
      },
    };
  }

  readConfiguration(options?: ReadOptions): Promise<InstallationConfiguration> {
    return this.#configurationSource.read(options);
  }

  /**
   * Q1-Q8 of the Vidya configuration inside Sankhya (CFG-8, spike §9.49), through the same serialized
   * `DbExplorerSP.executeQuery` path as the mirrors. Each query yields a typed result or a per-query
   * failure marker (permanent/validation/temporary, or Q1 != 1 row), so a partial read is never
   * silent. Auth, unavailable and rate-limit failures stop the run and are thrown as classified errors
   * (every remaining query would fail the same way).
   */
  async readConfigurationFacts(options?: ReadOptions): Promise<ConfigurationFacts> {
    const signal = options?.signal;
    const readAt = new Date(this.#now()).toISOString();
    const run = async <T>(def: ConfigQueryDef<T>): Promise<ConfigQueryResult<T>> => {
      signal?.throwIfAborted();
      try {
        const page = await this.#query(def.sql, def.columns, signal);
        if (def.exactlyOneRow === true && page.rows.length !== 1) {
          throw new SankhyaGatewayError('validation', {
            code: 'configuration_row_count',
            message: `${def.id}: expected exactly one configuration row (NUCFG = 1) and the ERP returned ${page.rows.length}.`,
          });
        }
        const rows = page.rows.map((cells, index) => def.map(new RowReader('configuration', def.columns, cells, index)));
        return { ok: true, source: def.source, rows };
      } catch (error) {
        if (!(error instanceof SankhyaGatewayError)) throw error;
        if (error.kind === 'auth' || error.kind === 'unavailable' || error.kind === 'rate_limit') throw error;
        return {
          ok: false,
          source: def.source,
          error: {
            kind: error.kind,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(error.code === 'sql_error' ? oracleDetail(error.message) : {}),
          },
        };
      }
    };
    const q1GeneralParameters = await this.#readQ1(run, signal);
    const q2Companies = await run(CONFIG_QUERIES.Q2);
    const q3EnabledTops = await run(CONFIG_QUERIES.Q3);
    const q4TopGroups = await run(CONFIG_QUERIES.Q4);
    const q5NegotiationTypes = await run(CONFIG_QUERIES.Q5);
    const q6PriceTables = await run(CONFIG_QUERIES.Q6);
    const q7OrderStatuses = await run(CONFIG_QUERIES.Q7);
    const q8ProductMobility = await run(CONFIG_QUERIES.Q8);
    return {
      readAt,
      q1GeneralParameters,
      q2Companies,
      q3EnabledTops,
      q4TopGroups,
      q5NegotiationTypes,
      q6PriceTables,
      q7OrderStatuses,
      q8ProductMobility,
    };
  }

  /**
   * Q1 over the columns that exist in this schema (the Sandbox copy of AD_TVDYCFGFRC has fewer columns than the
   * production one). The discovery reads names only; a required column that is absent fails Q1 closed.
   */
  async #readQ1(
    run: <T>(def: ConfigQueryDef<T>) => Promise<ConfigQueryResult<T>>,
    signal: AbortSignal | undefined,
  ): Promise<ConfigQueryResult<GeneralParametersRow>> {
    const fullSource = CONFIG_QUERIES.Q1.source;
    const discovery = await run<string>({
      id: 'Q1',
      sql: Q1_COLUMN_DISCOVERY_SQL,
      columns: Q1_COLUMN_DISCOVERY_COLUMNS,
      source: { tables: ['USER_TAB_COLUMNS'], columns: Q1_COLUMN_DISCOVERY_COLUMNS, filter: "TABLE_NAME = 'AD_TVDYCFGFRC'" },
      map: (row) => row.nullableText('COLUMN_NAME') ?? '',
    });
    signal?.throwIfAborted();
    if (!discovery.ok) return { ok: false, source: fullSource, error: discovery.error };
    const built = buildQ1(discovery.rows);
    if (!built.ok) {
      const names = built.missingRequired.join(', ');
      return {
        ok: false,
        source: fullSource,
        error: {
          kind: 'validation',
          code: 'configuration_column_missing',
          message: `Q1: required column(s) ${names} do not exist in AD_TVDYCFGFRC of this ERP schema.`,
          retryable: false,
          detail: names,
        },
      };
    }
    return run(built.def);
  }

  readSellers(options?: ReadOptions) {
    return this.#paged(SELLER_SPEC, options);
  }
  readDirectoryUsers(options?: ReadOptions) {
    return this.#paged(DIRECTORY_USER_SPEC, options);
  }
  readCarriers(options?: ReadOptions): Snapshot<Carrier> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const gateway = this;
    return {
      async *[Symbol.asyncIterator]() {
        const tally: Record<string, number> = {};
        // D-V: partners that are not flagged TRANSPORTADORA = 'S' (null included) = all real partners minus the flagged ones.
        const total = await gateway.#countOf("SELECT COUNT(*) AS TOTAL FROM TGFPAR WHERE CODPARC > 0", options?.signal);
        const flagged = await gateway.#countOf("SELECT COUNT(*) AS TOTAL FROM TGFPAR WHERE TRANSPORTADORA = 'S' AND CODPARC > 0", options?.signal);
        tally['flag:TRANSPORTADORA'] = Math.max(total - flagged, 0);
        yield* gateway.#paged(carrierSpec(tally), options, tally);
      },
    };
  }

  async #countOf(sql: string, signal?: AbortSignal): Promise<number> {
    const result = await this.#query(sql, ['TOTAL'], signal);
    const value = new RowReader('carriers', ['TOTAL'], result.rows[0] ?? [], 0).nullableInt('TOTAL');
    if (result.rows.length !== 1 || value === null) {
      throw new SankhyaGatewayError('temporary', { code: 'incomplete_snapshot', message: 'carriers: the ERP row count could not be read. Retry.' });
    }
    return value;
  }
  readIpiRates(options?: ReadOptions) {
    return this.#paged(IPI_RATE_SPEC, options);
  }
  readOpenTitles(options?: ReadOptions) {
    return this.#paged(OPEN_TITLE_SPEC, options);
  }
  readCustomers(options?: ReadOptions): Snapshot<Customer> {
    assertSafeScope(options?.scope);
    const rules = options?.scope?.customers;
    if (rules === undefined) return this.#paged(CUSTOMER_SPEC, options);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const gateway = this;
    return {
      async *[Symbol.asyncIterator]() {
        await gateway.#assertCustomerColumns(rules, options?.signal);
        const tally: Record<string, number> = {};
        yield* gateway.#paged(customerSpec(options?.scope, tally), options, tally);
      },
    };
  }

  /** D-V: the eligibility columns must exist in this ERP schema (USER_TAB_COLUMNS, as the adaptive Q1); a missing one fails closed. */
  async #assertCustomerColumns(rules: NonNullable<ReadScope['customers']>, signal?: AbortSignal): Promise<void> {
    const wanted = [...new Set([...rules.requiredFlags, ...rules.columnIn.map((r) => r.column)])];
    if (wanted.length === 0) return;
    const found = await this.#query(CUSTOMER_COLUMN_DISCOVERY_SQL, ['COLUMN_NAME'], signal);
    const present = new Set(found.rows.map((cells, index) => new RowReader('customers', ['COLUMN_NAME'], cells, index).nullableText('COLUMN_NAME') ?? ''));
    const missing = wanted.filter((c) => !present.has(c));
    if (missing.length > 0) {
      throw new SankhyaGatewayError('validation', {
        code: 'customer_eligibility_column_missing',
        message: `Customer eligibility column(s) ${missing.join(', ')} do not exist in TGFPAR of this ERP schema.`,
      });
    }
  }
  readProducts(options?: ReadOptions): Snapshot<Product> {
    assertSafeScope(options?.scope);
    if (options?.scope?.products?.usageValues.length === 0) return emptySnapshot();
    const filter = options?.scope?.products;
    const mobilityOn = filter !== undefined && (filter.mobilitySourceField ?? null) !== null && (filter.mobilityAllowedValues ?? []).length > 0;
    if (!mobilityOn) return this.#paged(productSpec(options?.scope), options);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const gateway = this;
    return {
      async *[Symbol.asyncIterator]() {
        // J2: products that pass every other rule but are not mobile-enabled = the same count without the mobility term minus with it.
        const withMobility = productSpec(options?.scope);
        const withoutMobility = productSpec({ ...options?.scope, products: { usageValues: filter.usageValues, activeOnly: filter.activeOnly, mobilitySourceField: filter.mobilitySourceField } });
        const all = await gateway.#countOf(`SELECT COUNT(*) AS TOTAL FROM ${withoutMobility.table} WHERE ${withoutMobility.where}`, options?.signal);
        const kept = await gateway.#countOf(`SELECT COUNT(*) AS TOTAL FROM ${withMobility.table} WHERE ${withMobility.where}`, options?.signal);
        const tally: Record<string, number> = { mobility: Math.max(all - kept, 0) };
        yield* gateway.#paged(withMobility, options, tally);
      },
    };
  }

  readProductGroups(options?: ReadOptions): Snapshot<ProductGroup> {
    return this.#paged(PRODUCT_GROUP_SPEC, options);
  }

  readPriceTables(options?: ReadOptions): Snapshot<PriceTable> {
    assertSafeScope(options?.scope);
    if (options?.scope?.priceTableCodes?.length === 0) return emptySnapshot();
    return this.#paged(priceTableSpec(options?.scope), options);
  }

  /**
   * Without `scope.priceTableCodes`: every stored version. With it: only the configured tables, and per
   * table only the current version (latest DTVIGOR up to now) plus future ones, so superseded prices
   * never mix with current ones.
   */
  readPriceTableVersions(options?: ReadOptions): Snapshot<PriceTableVersion> {
    assertSafeScope(options?.scope);
    const codes = options?.scope?.priceTableCodes;
    if (codes?.length === 0) return emptySnapshot();
    if (codes === undefined) return this.#paged(priceTableVersionSpec(undefined), options);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const gateway = this;
    return {
      async *[Symbol.asyncIterator]() {
        const effective = await gateway.#effectiveVersions(options);
        if (effective.length > 0) yield effective;
      },
    };
  }

  /**
   * Prices are delivered only once the WHOLE snapshot was read and validated: a row that breaks the
   * contract (for example a negative `VLRVENDA`) or a count mismatch rejects the snapshot before the
   * caller sees any batch, so a price run never replaces prices partially. The set is small (one
   * current version per mobile table), so buffering it is cheap.
   */
  readListPrices(options?: ReadOptions): Snapshot<ListPrice> {
    assertSafeScope(options?.scope);
    const codes = options?.scope?.priceTableCodes;
    if (codes?.length === 0) return emptySnapshot();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const gateway = this;
    return {
      async *[Symbol.asyncIterator]() {
        let spec = listPriceSpec(undefined);
        if (codes !== undefined) {
          const versions = await gateway.#effectiveVersions(options);
          if (versions.length === 0) return;
          spec = listPriceSpec(versions.map((v) => v.versionId));
        }
        const batches: (readonly ListPrice[])[] = [];
        for await (const batch of gateway.#paged(spec, options)) batches.push(batch);
        yield* batches;
      },
    };
  }

  async #effectiveVersions(options: ReadOptions | undefined): Promise<PriceTableVersion[]> {
    const all: PriceTableVersion[] = [];
    for await (const batch of this.#paged(priceTableVersionSpec(options?.scope), options)) all.push(...batch);
    const now = options?.scope?.now ?? new Date(this.#now()).toISOString();
    return selectEffectiveVersions(all, now);
  }

  // ---- product photos (F-54, F-55) --------------------------------------------------------------

  /** One batched SELECT per page (keyset on the product code); the image itself is never selected. */
  async readProductMediaSignatures(options: ReadProductMediaSignaturesOptions): Promise<readonly ProductMediaSignature[]> {
    const after = assertSignaturesOptions(options);
    assertSafeScope(options.scope);
    options.signal?.throwIfAborted();
    if (options.scope?.products?.usageValues.length === 0) return [];
    const page = await this.#query(
      productMediaSignaturesSql(options.scope, after, options.limit),
      PRODUCT_MEDIA_SIGNATURE_COLUMNS,
      options.signal,
    );
    if (page.rows.length > options.limit) {
      throw new SankhyaGatewayError('validation', {
        code: 'invalid_gateway_response',
        message: 'The ERP returned more product photo rows than requested.',
      });
    }
    const result: ProductMediaSignature[] = [];
    let previous = after;
    for (const [index, cells] of page.rows.entries()) {
      const row = new RowReader('products', PRODUCT_MEDIA_SIGNATURE_COLUMNS, cells, index);
      const productCode = row.int('CODPROD');
      const byteLength = row.int('LEN');
      if (productCode <= previous) {
        throw new SankhyaGatewayError('temporary', {
          code: 'snapshot_inconsistent',
          message: 'products: photo rows came back duplicated or out of order. The page was rejected; retry.',
        });
      }
      previous = productCode;
      if (byteLength < 1) row.reject('LEN', 'is not a positive size');
      const windows = mediaSampleOffsets(byteLength).map((offset, i) => {
        const hex = row.text(`W${i}`);
        if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length !== mediaSampleWidth(byteLength, offset) * 2) {
          row.reject(`W${i}`, 'is not the expected hex window');
        }
        return hex;
      });
      result.push({ productCode, byteLength, fingerprint: mediaFingerprint(byteLength, windows) });
    }
    return result;
  }

  /**
   * Sequential 2000-byte hex chunks through the serialized request path, verified against the announced
   * length and re-checked against the ERP length at the end. Nothing partial is ever returned.
   */
  async readProductMediaBytes(options: ReadProductMediaBytesOptions): Promise<Uint8Array> {
    assertBytesOptions(options);
    const { productCode, expectedLength, signal } = options;
    signal?.throwIfAborted();
    const bytes = new Uint8Array(expectedLength);
    let filled = 0;
    while (filled < expectedLength) {
      signal?.throwIfAborted();
      const want = Math.min(MEDIA_CHUNK_BYTES, expectedLength - filled);
      const page = await this.#query(productMediaChunkSql(productCode, filled + 1, want), PRODUCT_MEDIA_CHUNK_COLUMNS, signal);
      const cell = page.rows.length === 1 ? page.rows[0]?.[0] : undefined;
      if (page.rows.length > 1) {
        throw new SankhyaGatewayError('validation', {
          code: 'invalid_gateway_response',
          message: `Product ${productCode}: the ERP returned more than one row for a single image chunk (offset ${filled + 1}).`,
        });
      }
      if (typeof cell !== 'string') throw mediaChangedDuringRead(productCode, `no data at offset ${filled + 1}`);
      if (cell.length !== want * 2 || !/^[0-9a-fA-F]*$/.test(cell)) {
        if (cell.length < want * 2 && /^[0-9a-fA-F]*$/.test(cell) && cell.length % 2 === 0) {
          throw mediaChangedDuringRead(productCode, `short chunk at offset ${filled + 1}`);
        }
        throw new SankhyaGatewayError('validation', {
          code: 'invalid_media_chunk',
          message: `Product ${productCode}: the image chunk at offset ${filled + 1} is not hex data of the expected size.`,
        });
      }
      for (let i = 0; i < want; i += 1) bytes[filled + i] = Number.parseInt(cell.slice(i * 2, i * 2 + 2), 16);
      filled += want;
    }
    signal?.throwIfAborted();
    const check = await this.#query(productMediaLengthSql(productCode), PRODUCT_MEDIA_LENGTH_COLUMNS, signal);
    const length = new RowReader('products', PRODUCT_MEDIA_LENGTH_COLUMNS, check.rows[0] ?? [], 0).nullableInt('LEN');
    if (check.rows.length !== 1 || length !== expectedLength) {
      throw mediaChangedDuringRead(productCode, 'the stored length differs after reading');
    }
    return bytes;
  }

  // ---- order delivery (SNK-7) ---------------------------------------------------------------

  /**
   * CACSP.incluirNota (F-44). Refuses without any HTTP call unless the worker configuration is `live`
   * (Sandbox, gates marker, origin field: validated at boot). The caller has ALREADY proven by
   * `findOrderByOrigin` that the order is absent (SNK-4).
   */
  async includeOrder(request: OrderWriteRequest, options?: OrderCallOptions): Promise<IncludeOrderResult> {
    if (this.#orderWrite.mode !== 'live' || this.#orderWrite.originField !== request.originField) {
      throw new NotImplementedError(ORDER_WRITE_NOT_ENABLED_MESSAGE);
    }
    const body = buildIncluirNotaRequestText(request);
    const response = await this.#write(INCLUIR_NOTA_PATH, body, options?.signal);
    return parseIncluirNotaResponse(response.status, response.body, parseRetryAfterMs(response.headers['retry-after']));
  }

  /** NEEDS VALIDATION: the CACSP.confirmarNota request shape is not recorded anywhere (SNK-7 D-4, D-10). */
  confirmOrder(erpOrderNumber: number, options?: OrderCallOptions): Promise<void> {
    void erpOrderNumber;
    void options;
    return Promise.reject(
      new NotImplementedError('confirmOrder: the CACSP.confirmarNota request shape is not validated. NEEDS VALIDATION S3 (SNK-7 D-4, D-10).'),
    );
  }

  async findOrderByOrigin(originField: string, originId: string, options?: OrderCallOptions): Promise<ErpOrderRef | null> {
    // Both values reach the SQL text: strictly validated, never escaped-and-hoped.
    if (!isValidOriginField(originField)) throw invalidOrderQuery('the origin field name is not valid');
    if (!UUID_PATTERN.test(originId)) throw invalidOrderQuery('the origin id is not a UUID');
    const columns = ['NUNOTA', 'STATUSNOTA'] as const;
    const result = await this.#query(
      `SELECT NUNOTA, STATUSNOTA FROM TGFCAB WHERE ${originField} = '${originId.toLowerCase()}'`,
      columns,
      options?.signal,
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length > 1) {
      // A duplicate already exists: the worker must stop and escalate, never pick one (K2).
      const numbers = result.rows.map((row, index) => new RowReader('orders', columns, row, index).int('NUNOTA'));
      throw new AmbiguousOriginError(numbers);
    }
    const reader = new RowReader('orders', columns, result.rows[0] ?? [], 0);
    return { erpOrderNumber: reader.int('NUNOTA'), confirmed: reader.nullableText('STATUSNOTA') === 'L' };
  }

  /** NEEDS VALIDATION (spike 9.48 item 9): where the ERP status facts live is not known; no query is invented. */
  readOrderStatusFacts(erpOrderNumbers: readonly number[], options?: OrderCallOptions): Promise<readonly ErpOrderStatusReading[]> {
    void erpOrderNumbers;
    void options;
    return Promise.reject(
      new NotImplementedError('readOrderStatusFacts: the source of the ERP order status is not validated. NEEDS VALIDATION (SNK-7 P2, spike 9.48).'),
    );
  }

  async readWrittenOrder(erpOrderNumber: number, options?: OrderCallOptions): Promise<WrittenOrder | null> {
    if (!Number.isInteger(erpOrderNumber) || erpOrderNumber < 1) throw invalidOrderQuery('the order number is not a positive integer');
    const headerColumns = ['NUNOTA', 'STATUSNOTA', 'VLRNOTA', 'VLRIPI'] as const;
    const header = await this.#query(
      `SELECT NUNOTA, STATUSNOTA, VLRNOTA, VLRIPI FROM TGFCAB WHERE NUNOTA = ${erpOrderNumber}`,
      headerColumns,
      options?.signal,
    );
    if (header.rows.length === 0) return null;
    const reader = new RowReader('orders', headerColumns, header.rows[0] ?? [], 0);
    const itemColumns = ['CODPROD', 'QTDNEG', 'VLRUNIT', 'PERCDESC', 'VLRDESC', 'VLRIPI'] as const;
    const itemRows = await this.#query(
      `SELECT CODPROD, QTDNEG, VLRUNIT, PERCDESC, VLRDESC, VLRIPI FROM TGFITE WHERE NUNOTA = ${erpOrderNumber} ORDER BY CODPROD`,
      itemColumns,
      options?.signal,
    );
    const items: WrittenOrderItem[] = itemRows.rows.map((cells, index) => {
      const row = new RowReader('orders', itemColumns, cells, index);
      const decimal = (column: (typeof itemColumns)[number]) => {
        const parsed = decimalFromCell(cells[itemColumns.indexOf(column)]);
        if (!parsed.ok) return row.reject(column, parsed.problem);
        return parsed.value;
      };
      const rawDiscount = cells[itemColumns.indexOf('PERCDESC')];
      const rawAmount = cells[itemColumns.indexOf('VLRDESC')];
      const rawIpi = cells[itemColumns.indexOf('VLRIPI')];
      return {
        productCode: row.int('CODPROD'),
        quantity: decimal('QTDNEG'),
        unitPrice: decimal('VLRUNIT'),
        discountPercent: rawDiscount === null || rawDiscount === undefined ? null : decimal('PERCDESC'),
        discountAmount: rawAmount === null || rawAmount === undefined ? null : decimal('VLRDESC'),
        ipiAmount: rawIpi === null || rawIpi === undefined ? null : decimal('VLRIPI'),
      };
    });
    const headerDecimal = (column: 'VLRNOTA' | 'VLRIPI'): string | null => {
      const cell = (header.rows[0] ?? [])[headerColumns.indexOf(column)];
      if (cell === null || cell === undefined) return null;
      const parsed = decimalFromCell(cell);
      if (!parsed.ok) return reader.reject(column, parsed.problem);
      return parsed.value;
    };
    return {
      erpOrderNumber: reader.int('NUNOTA'),
      confirmed: reader.nullableText('STATUSNOTA') === 'L',
      totalAmount: headerDecimal('VLRNOTA'),
      ipiAmount: headerDecimal('VLRIPI'),
      items,
    };
  }

  /**
   * The single exit point for ERP writes: Sandbox allow-list (SNK-7 S2) AND the installation
   * allow-list, serialized with every other request, one token renewal on 403 (the gateway rejected
   * the token before running the service, so nothing was written).
   */
  #write(path: string, body: string, signal?: AbortSignal): Promise<HttpResponse> {
    const run = this.#queue.then(async () => {
      signal?.throwIfAborted();
      const send = async (): Promise<HttpResponse> => {
        const token = await this.#tokens.getToken(signal);
        const url = `${this.#origin}${path}`;
        assertSandboxHost(url);
        assertRequestUrlAllowed(url, this.#allowedHosts);
        return this.#transport({
          method: 'POST',
          url,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${token.reveal()}`,
          },
          body,
          timeoutMs: this.#includeTimeoutMs,
          signal,
        });
      };
      let response = await send();
      if (response.status === 403) {
        this.#tokens.invalidate();
        response = await send();
      }
      return response;
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  // ---- paging -------------------------------------------------------------------------------

  #paged<T>(spec: EntitySpec<T>, options?: ReadOptions, tally?: Record<string, number>): Snapshot<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const gateway = this;
    return {
      async *[Symbol.asyncIterator]() {
        const signal = options?.signal;
        signal?.throwIfAborted();
        const context = { dbUtcOffsetMinutes: gateway.#dbUtcOffsetMinutes };
        const pageSize = gateway.#pageSize;
        let offset = 0;
        let total = 0;
        let discarded = 0;
        let previousKey: readonly number[] | null = null;

        for (;;) {
          signal?.throwIfAborted();
          const page = await gateway.#query(pageSql(spec, offset, pageSize), spec.columns, signal);
          const mapped: T[] = [];
          for (const [index, cells] of page.rows.entries()) {
            const result = spec.map(new RowReader(spec.entity, spec.columns, cells, index), context);
            if (isRowDiscard(result)) {
              // Counted as read (the ERP count includes it) but never delivered; the reason carries no value.
              discarded += 1;
              if (result.silent !== true) options?.onWarning?.(`${spec.entity}: row ${offset + index} discarded (${result.discarded}).`);
              continue;
            }
            const row = result;
            const key = spec.keyOf(row);
            if (previousKey !== null && compareKeys(key, previousKey) <= 0) {
              throw new SankhyaGatewayError('temporary', {
                code: 'snapshot_inconsistent',
                message: `${spec.entity}: rows came back duplicated or out of order between pages (the data may have changed during the read). The snapshot was rejected; retry.`,
              });
            }
            previousKey = key;
            mapped.push(row);
          }
          if (mapped.length > 0) yield mapped;
          total += mapped.length;
          offset += pageSize;
          if (page.rows.length < pageSize) break;
        }

        const counted = await gateway.#query(countSql(spec), ['TOTAL'], signal);
        const expected = new RowReader(spec.entity, ['TOTAL'], counted.rows[0] ?? [], 0).nullableInt('TOTAL');
        if (counted.rows.length !== 1 || expected === null || expected !== total + discarded) {
          throw new SankhyaGatewayError('temporary', {
            code: 'incomplete_snapshot',
            message: `${spec.entity}: the number of rows read does not match the ERP row count (the data may have changed during the read). The snapshot was rejected; retry.`,
          });
        }
        if (tally !== undefined) options?.onExcluded?.(spec.entity, { ...tally });
      },
    };
  }

  // ---- gateway call -------------------------------------------------------------------------

  /** Serializes requests: one in flight at a time (request limits are unmeasured, S0.2). */
  #query(sql: string, expectedColumns: readonly string[], signal?: AbortSignal): Promise<QueryResult> {
    const run = this.#queue.then(() => this.#execute(sql, expectedColumns, signal));
    // Keep the queue alive after a failure; the caller still sees the rejection through `run`.
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #execute(sql: string, expectedColumns: readonly string[], signal?: AbortSignal): Promise<QueryResult> {
    signal?.throwIfAborted();
    let response = await this.#send(sql, signal);
    if (response.status === 403) {
      // Expired or invalid bearer token (F-31, GTW3403): renew once and retry once.
      this.#tokens.invalidate();
      response = await this.#send(sql, signal);
    }
    return parseQueryResponse(response, expectedColumns);
  }

  async #send(sql: string, signal?: AbortSignal): Promise<HttpResponse> {
    const token = await this.#tokens.getToken(signal);
    const url = `${this.#origin}${GATEWAY_PATH}?serviceName=${QUERY_SERVICE}&outputType=json`;
    assertRequestUrlAllowed(url, this.#allowedHosts);
    return this.#transport({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token.reveal()}`,
      },
      body: JSON.stringify({ serviceName: QUERY_SERVICE, requestBody: { sql } }),
      timeoutMs: this.#requestTimeoutMs,
      signal,
    });
  }
}

type QueryShape = Pick<EntitySpec<never>, 'select' | 'table' | 'where' | 'orderBy'>;

interface QueryResult {
  readonly rows: readonly (readonly unknown[])[];
}

function pageSql(spec: QueryShape, offset: number, pageSize: number): string {
  // Only integers we computed are interpolated; nothing external ever reaches the SQL text.
  return `SELECT ${spec.select.join(', ')} FROM ${spec.table}${whereClause(spec)} ORDER BY ${spec.orderBy} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
}

function countSql(spec: QueryShape): string {
  return `SELECT COUNT(*) AS TOTAL FROM ${spec.table}${whereClause(spec)}`;
}

function whereClause(spec: QueryShape): string {
  return spec.where === undefined ? '' : ` WHERE ${spec.where}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidOrderQuery(detail: string): SankhyaGatewayError {
  return new SankhyaGatewayError('validation', { code: 'invalid_order_query', message: `Order lookup refused: ${detail}.` });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidEnvelope(detail: string): SankhyaGatewayError {
  return new SankhyaGatewayError('validation', {
    code: 'invalid_gateway_response',
    message: `The ERP gateway response did not have the expected shape (${detail}).`,
  });
}

/**
 * Wire format from the public developer documentation (VALIDATED (docs)); the envelope fields
 * `status`, `statusMessage`, `responseBody.fieldsMetadata[].name`, `responseBody.rows`,
 * `responseBody.burstLimit` are confirmed by F-19/F-23 evidence. Anything else fails closed.
 */
export function parseQueryResponse(response: HttpResponse, expectedColumns: readonly string[]): QueryResult {
  if (response.status !== 200) {
    throw classifyHttpFailure(response.status, 'ERP query', parseRetryAfterMs(response.headers['retry-after']));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw invalidEnvelope('not JSON');
  }
  if (!isRecord(parsed)) throw invalidEnvelope('not an object');

  const status = parsed['status'];
  if (status === '0' || status === 0) {
    // HTTP 200 with status 0 = SQL/service error (F-19). Permanent: the same statement fails again.
    const message = typeof parsed['statusMessage'] === 'string' ? parsed['statusMessage'] : '';
    const oracleCode = /ORA-\d{5}/.exec(message)?.[0];
    throw new SankhyaGatewayError('permanent', {
      code: 'sql_error',
      message: `The ERP rejected the query${oracleCode ? ` (${oracleCode})` : ''}. Check that the integration user may read the table and that the schema matches the validated contract.`,
    });
  }
  if (status !== '1' && status !== 1) {
    throw new SankhyaGatewayError('temporary', {
      code: 'unknown_gateway_status',
      message: 'The ERP gateway returned an unrecognized status; treated as a temporary failure.',
    });
  }

  const body = parsed['responseBody'];
  if (!isRecord(body)) throw invalidEnvelope('responseBody missing');
  if (body['burstLimit'] === true || body['burstLimit'] === 'true') {
    throw new SankhyaGatewayError('validation', {
      code: 'burst_limit',
      message: 'The ERP truncated the result at its row cap (burstLimit); the page size must stay below the cap. The snapshot was rejected.',
    });
  }
  const metadata = body['fieldsMetadata'];
  const rows = body['rows'];
  if (!Array.isArray(metadata) || !Array.isArray(rows)) throw invalidEnvelope('fieldsMetadata/rows missing');
  const names = metadata.map((field) => (isRecord(field) && typeof field['name'] === 'string' ? field['name'].toUpperCase() : null));
  if (names.length !== expectedColumns.length || names.some((name, i) => name !== expectedColumns[i])) {
    throw invalidEnvelope('result columns differ from the query');
  }
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== expectedColumns.length) throw invalidEnvelope('row width differs from the query');
  }
  return { rows: rows as readonly (readonly unknown[])[] };
}

/** The ORA code of a sql_error message, when it has one (never the statement text). */
function oracleDetail(message: string): { detail: string } | Record<string, never> {
  const code = /ORA-[0-9]{5}/.exec(message)?.[0];
  return code === undefined ? {} : { detail: code };
}

function emptySnapshot<T>(): Snapshot<T> {
  return {
    // eslint-disable-next-line require-yield
    async *[Symbol.asyncIterator]() {
      return;
    },
  };
}
