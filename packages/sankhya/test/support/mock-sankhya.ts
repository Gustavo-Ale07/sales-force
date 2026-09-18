import type { DemoDataset } from '../../src/fake/demo-data.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../../src/real/transport.js';

/**
 * In-memory stand-in for the ERP HTTP layer used by the real-adapter tests. It speaks the wire format
 * the adapter expects (from the public developer documentation; see `test/fixtures/README.md`) and
 * interprets ONLY the statement shapes the adapter emits. No network is ever opened.
 * Every value here is synthetic.
 */

export type ErpRow = Record<string, unknown>;
export type ErpTables = Record<string, ErpRow[]>;

export const TEST_CREDENTIALS: { clientId: string; clientSecret: string; xToken: string } = {
  clientId: 'test-client-id-0001',
  clientSecret: 'test-client-secret-0002',
  xToken: 'test-x-token-0003',
};

export const TEST_BASE_URL = 'https://erp.example.test';
export const TEST_HOST = 'erp.example.test';

export interface RecordedCall {
  readonly kind: 'authenticate' | 'query';
  readonly url: string;
  readonly sql?: string;
  readonly at: number;
}

export interface ClockRef {
  now: number;
}

const TOKEN_LIFETIME_SECONDS = 300;

function flag(value: boolean): 'S' | 'N' {
  return value ? 'S' : 'N';
}

/** Inverse mapping of the adapter: the ERP rows that would produce the given Sales Force dataset. */
export function erpTablesFromDataset(dataset: DemoDataset, dbUtcOffsetMinutes = -180): ErpTables {
  return {
    TGFVEN: dataset.sellers.map((s) => ({ CODVEND: s.code, APELIDO: s.name, ATIVO: flag(s.active) })),
    TGFPAR: [
      ...dataset.customers.map((c) => ({
        CODPARC: c.code,
        CLIENTE: 'S',
        NOMEPARC: c.tradeName,
        RAZAOSOCIAL: c.name,
        CGC_CPF: c.document,
        ATIVO: flag(c.active),
        BLOQUEAR: flag(c.blocked),
        CODVEND: c.sellerCode,
        CODTAB: c.priceTableCode,
        LIMCRED: c.creditLimit === null ? null : Number(c.creditLimit),
      })),
      // A non-customer partner (supplier): must never reach the mirror.
      {
        CODPARC: 999_999,
        CLIENTE: 'N',
        NOMEPARC: 'Fornecedor Sintetico',
        RAZAOSOCIAL: 'Fornecedor Sintetico Ltda',
        CGC_CPF: null,
        ATIVO: 'S',
        BLOQUEAR: 'N',
        CODVEND: 0,
        CODTAB: null,
        LIMCRED: null,
      },
    ],
    TGFPRO: dataset.products.map((p) => ({
      CODPROD: p.code,
      DESCRPROD: p.description,
      ATIVO: flag(p.active),
      USOPROD: p.usageCode,
      CODGRUPOPROD: p.groupCode,
      CODVOL: p.unit,
      MARCA: p.brand,
      REFERENCIA: p.reference,
    })),
    TGFTAB: dataset.priceTableVersions.map((v) => ({
      NUTAB: v.versionId,
      CODTAB: v.tableCode,
      DTVIGOR: new Date(Date.parse(v.effectiveFrom) + dbUtcOffsetMinutes * 60_000).toISOString().slice(0, 10),
    })),
    TGFEXC: dataset.listPrices.map((p) => ({
      NUTAB: p.versionId,
      CODPROD: p.productCode,
      CODLOCAL: 0,
      CONTROLE: ' ',
      VLRVENDA: Number(p.unitPrice),
    })),
  };
}

const SELECT_RE =
  /^SELECT (.+) FROM (\w+)(?: WHERE (.+?))? ORDER BY (.+?) OFFSET (\d+) ROWS FETCH NEXT (\d+) ROWS ONLY$/;
const COUNT_RE = /^SELECT COUNT\(\*\) AS TOTAL FROM (\w+)(?: WHERE (.+))?$/;

function keyColumns(orderBy: string): string[] {
  return orderBy.split(',').map((c) => c.trim());
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function whereMatches(row: ErpRow, where: string | undefined): boolean {
  if (where === undefined) return true;
  const match = /^(\w+) = '(\w)'$/.exec(where);
  if (!match) throw new Error(`mock cannot interpret WHERE: ${where}`);
  return row[match[1] as string] === match[2];
}

/** `"TO_CHAR(DTVIGOR, 'YYYY-MM-DD') AS DTVIGOR"` -> `{ expression, alias, column }`. */
function parseSelectItem(item: string): { alias: string; column: string } {
  const aliased = /^(.+) AS (\w+)$/.exec(item.trim());
  const expression = aliased ? (aliased[1] as string) : item.trim();
  const alias = aliased ? (aliased[2] as string) : item.trim();
  const inner = /^TO_CHAR\((\w+),/.exec(expression);
  return { alias, column: inner ? (inner[1] as string) : expression };
}

export interface MockSankhyaOptions {
  readonly tables: ErpTables;
  readonly clock: ClockRef;
}

export type ForcedResponse = HttpResponse | ((request: HttpRequest) => HttpResponse | Promise<HttpResponse>);

export class MockSankhya {
  tables: ErpTables;
  readonly clock: ClockRef;
  readonly calls: RecordedCall[] = [];
  /** Responses returned (in order) for the next gateway queries instead of the normal answer. */
  readonly forced: ForcedResponse[] = [];
  /** Runs before each query is answered (tests mutate data or count concurrency here). */
  beforeQuery: ((sql: string) => void | Promise<void>) | undefined;
  authCount = 0;
  maxInFlight = 0;
  #inFlight = 0;
  #validTokens = new Map<string, number>();
  #seq = 0;

  constructor(options: MockSankhyaOptions) {
    this.tables = options.tables;
    this.clock = options.clock;
  }

  readonly transport: HttpTransport = async (request) => {
    this.#inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.#inFlight);
    try {
      // Yield so overlapping requests would be observable.
      await Promise.resolve();
      return await this.#handle(request);
    } finally {
      this.#inFlight -= 1;
    }
  };

  queries(): RecordedCall[] {
    return this.calls.filter((call) => call.kind === 'query');
  }

  /** Invalidates every token issued so far (simulates server-side expiry before the client's clock). */
  expireAllTokens(): void {
    this.#validTokens.clear();
  }

  async #handle(request: HttpRequest): Promise<HttpResponse> {
    const url = new URL(request.url);
    if (url.pathname === '/authenticate') return this.#authenticate(request);
    if (url.pathname === '/gateway/v1/mge/service.sbr') return this.#query(request);
    return { status: 404, headers: {}, body: '' };
  }

  #authenticate(request: HttpRequest): HttpResponse {
    this.calls.push({ kind: 'authenticate', url: request.url, at: this.clock.now });
    const form = new URLSearchParams(request.body);
    const ok =
      request.headers['x-token'] === TEST_CREDENTIALS.xToken &&
      form.get('grant_type') === 'client_credentials' &&
      form.get('client_id') === TEST_CREDENTIALS.clientId &&
      form.get('client_secret') === TEST_CREDENTIALS.clientSecret;
    if (!ok) return { status: 401, headers: {}, body: '{"error":"invalid_client"}' };
    this.authCount += 1;
    this.#seq += 1;
    const token = `synthetic-token-${this.#seq}`;
    this.#validTokens.set(token, this.clock.now + TOKEN_LIFETIME_SECONDS * 1000);
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: token, expires_in: TOKEN_LIFETIME_SECONDS, token_type: 'bearer' }),
    };
  }

  async #query(request: HttpRequest): Promise<HttpResponse> {
    const authorization = request.headers['authorization'];
    if (authorization === undefined) return { status: 401, headers: {}, body: '' };
    const token = authorization.replace(/^Bearer /, '');
    const expiresAt = this.#validTokens.get(token);
    if (expiresAt === undefined || this.clock.now >= expiresAt) {
      return {
        status: 403,
        headers: {},
        body: '{"error":{"codigo":"GTW3403","descricao":"Bearer Token invalido ou Expirado."}}',
      };
    }

    const parsed = JSON.parse(request.body) as { serviceName: string; requestBody: { sql: string } };
    const sql = parsed.requestBody.sql;
    this.calls.push({ kind: 'query', url: request.url, sql, at: this.clock.now });
    if (this.beforeQuery) await this.beforeQuery(sql);

    const forced = this.forced.shift();
    if (forced !== undefined) return typeof forced === 'function' ? forced(request) : forced;
    return this.#answer(sql);
  }

  #answer(sql: string): HttpResponse {
    const count = COUNT_RE.exec(sql);
    if (count) {
      const rows = (this.tables[count[1] as string] ?? []).filter((row) => whereMatches(row, count[2]));
      return ok(['TOTAL'], [[rows.length]]);
    }
    const select = SELECT_RE.exec(sql);
    if (!select) throw new Error(`mock cannot interpret SQL: ${sql}`);
    const [, list, table, where, orderBy, offset, limit] = select as unknown as [string, string, string, string | undefined, string, string, string];
    const items = list.split(/,(?![^(]*\))/).map(parseSelectItem);
    const order = keyColumns(orderBy);
    const sorted = (this.tables[table] ?? [])
      .filter((row) => whereMatches(row, where))
      .sort((a, b) => {
        for (const column of order) {
          const difference = compareValues(a[column], b[column]);
          if (difference !== 0) return difference;
        }
        return 0;
      });
    const page = sorted.slice(Number(offset), Number(offset) + Number(limit));
    return ok(
      items.map((item) => item.alias),
      page.map((row) => items.map((item) => row[item.column] ?? null)),
    );
  }
}

export function ok(columns: readonly string[], rows: readonly (readonly unknown[])[], burstLimit = false): HttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serviceName: 'DbExplorerSP.executeQuery',
      status: '1',
      responseBody: {
        fieldsMetadata: columns.map((name, order) => ({ name, order: order + 1 })),
        rows,
        burstLimit,
      },
    }),
  };
}

export function sqlError(message = 'ORA-00942: table or view does not exist'): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', status: '0', statusMessage: message }),
  };
}

export function httpStatus(status: number, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers, body: '' };
}
