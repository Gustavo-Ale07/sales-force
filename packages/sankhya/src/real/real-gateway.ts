import type {
  InstallationConfiguration,
  ListPrice,
  PriceTable,
  PriceTableVersion,
  Product,
  ProductGroup,
} from '@salesforce/domain';
import { assertSafeScope, selectEffectiveVersions } from '../read-scope.js';
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
  SankhyaGatewayError,
  classifyHttpFailure,
  parseRetryAfterMs,
} from '../errors.js';
import {
  READ_ENTITIES,
  SUBMIT_ORDER_NOT_IMPLEMENTED_MESSAGE,
  type EnvironmentKind,
  type GatewayDescription,
  type ReadOptions,
  type SankhyaGateway,
  type Snapshot,
  type SubmitOrderRequest,
  type SubmitOrderResult,
} from '../gateway.js';
import { assertBaseUrlAllowed, assertRequestUrlAllowed } from './host-guard.js';
import {
  CUSTOMER_SPEC,
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
  compareKeys,
  type EntitySpec,
} from './mapping.js';
import { TokenProvider, type SankhyaCredentials } from './token-provider.js';
import type { HttpResponse, HttpTransport } from './transport.js';

export const DEFAULT_PAGE_SIZE = 500;
/** Largest page size measured (F-23: 500 and 1,000). The 5,000-row silent cap (F-19) stays far away. */
export const MAX_PAGE_SIZE = 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
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
  readonly dbUtcOffsetMinutes?: number;
  /** Bootstrap file source for `readConfiguration()`; without it the read raises `NotImplementedError` (U-10). */
  readonly configurationSource?: ConfigurationSource;
}

/**
 * Read-only ERP adapter (P-02, P-03, STACK-2). Live use is opt-in (`createGateway`), credentials come
 * from the worker environment, and the class has NO write path: `submitOrder` rejects without any
 * HTTP call (SNK-4, SNK-5, SNK-6).
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
  readonly #dbUtcOffsetMinutes: number;
  readonly #configurationSource: ConfigurationSource;
  readonly #now: () => number;
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
    this.#dbUtcOffsetMinutes = options.dbUtcOffsetMinutes ?? DEFAULT_DB_UTC_OFFSET_MINUTES;
    this.#configurationSource = options.configurationSource ?? new UnavailableConfigurationSource();
    this.#now = options.now ?? Date.now;
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
        writes: { submitOrder: 'not_implemented' },
      },
    };
  }

  readConfiguration(options?: ReadOptions): Promise<InstallationConfiguration> {
    return this.#configurationSource.read(options);
  }

  readSellers(options?: ReadOptions) {
    return this.#paged(SELLER_SPEC, options);
  }
  readDirectoryUsers(options?: ReadOptions) {
    return this.#paged(DIRECTORY_USER_SPEC, options);
  }
  readCustomers(options?: ReadOptions) {
    return this.#paged(CUSTOMER_SPEC, options);
  }
  readProducts(options?: ReadOptions): Snapshot<Product> {
    assertSafeScope(options?.scope);
    if (options?.scope?.products?.usageValues.length === 0) return emptySnapshot();
    return this.#paged(productSpec(options?.scope), options);
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

  /** SNK-4 / SNK-5 / SNK-6: intentionally unimplemented; performs no HTTP call. */
  submitOrder(request: SubmitOrderRequest): Promise<SubmitOrderResult> {
    void request;
    return Promise.reject(new NotImplementedError(SUBMIT_ORDER_NOT_IMPLEMENTED_MESSAGE));
  }

  // ---- paging -------------------------------------------------------------------------------

  #paged<T>(spec: EntitySpec<T>, options?: ReadOptions): Snapshot<T> {
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
        let previousKey: readonly number[] | null = null;

        for (;;) {
          signal?.throwIfAborted();
          const page = await gateway.#query(pageSql(spec, offset, pageSize), spec.columns, signal);
          const mapped: T[] = [];
          for (const [index, cells] of page.rows.entries()) {
            const row = spec.map(new RowReader(spec.entity, spec.columns, cells, index), context);
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
        if (counted.rows.length !== 1 || expected === null || expected !== total) {
          throw new SankhyaGatewayError('temporary', {
            code: 'incomplete_snapshot',
            message: `${spec.entity}: the number of rows read does not match the ERP row count (the data may have changed during the read). The snapshot was rejected; retry.`,
          });
        }
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

function emptySnapshot<T>(): Snapshot<T> {
  return {
    // eslint-disable-next-line require-yield
    async *[Symbol.asyncIterator]() {
      return;
    },
  };
}
