import { mediaSampleOffsets, mediaSampleWidth, toHex } from '../../src/media.js';
import type { DemoDataset } from '../../src/fake/demo-data.js';
import type { DemoSalesNote } from '../../src/fake/demo-sales-history.js';
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
  readonly kind: 'authenticate' | 'query' | 'write';
  readonly url: string;
  readonly sql?: string;
  readonly body?: string;
  readonly at: number;
}

export interface ClockRef {
  now: number;
}

const TOKEN_LIFETIME_SECONDS = 300;

/** `TGFGRU.CODGRUPAI` of a root group (validated on the PLAC TESTE base). Not a real group code. */
export const ROOT_GROUP_SENTINEL = -999_999_999;

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
        LIMCREDMENSAL: c.monthlyCreditLimit === undefined || c.monthlyCreditLimit === null ? null : Number(c.monthlyCreditLimit),
        MOTBLOQ: c.blockReason ?? null,
        SITUACAO: c.situation ?? null,
      })),
      // Partners flagged as carriers (TRANSPORTADORA = S); not customers.
      ...dataset.carriers.map((c) => ({
        CODPARC: c.code,
        CLIENTE: 'N',
        TRANSPORTADORA: 'S',
        NOMEPARC: c.name,
        RAZAOSOCIAL: null,
        ATIVO: flag(c.active),
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
      CODIPI: p.ipiCode ?? null,
      AGRUPMIN: p.quantityStep ?? null,
    })),
    TGFFIN: [
      ...dataset.openTitles.map((t) => ({
        NUFIN: t.nufin,
        NUNOTA: t.documentNumber,
        CODPARC: t.customerCode,
        CODEMP: t.companyCode,
        DTVENC: t.dueDate,
        DHBAIXA: null,
        VLRDESDOB: Number(t.amount),
        VLRBAIXA: Number(t.paidAmount),
        RECDESP: 1,
        PROVISAO: 'N',
      })),
      // Never mirrored: a settled title, a payable and a provision.
      { NUFIN: 1, NUNOTA: 1, CODPARC: 1, CODEMP: 1, DTVENC: '2026-01-01', DHBAIXA: '2026-01-02', VLRDESDOB: 10, VLRBAIXA: 10, RECDESP: 1, PROVISAO: 'N' },
      { NUFIN: 2, NUNOTA: 2, CODPARC: 1, CODEMP: 1, DTVENC: '2026-01-01', DHBAIXA: null, VLRDESDOB: 10, VLRBAIXA: 0, RECDESP: -1, PROVISAO: 'N' },
      { NUFIN: 3, NUNOTA: 3, CODPARC: 1, CODEMP: 1, DTVENC: '2026-01-01', DHBAIXA: null, VLRDESDOB: 10, VLRBAIXA: 0, RECDESP: 1, PROVISAO: 'S' },
    ],
    TGFIPI: dataset.ipiRates.map((r) => ({
      CODIPI: r.code,
      DESCRICAO: r.description,
      PERCENTUAL: Number(r.percentual),
      VLRPAUTA: r.byTariff ? 1.5 : 0,
      PAUTACONDIC: 'N',
      CSTIPISAI: 50,
    })),
    TGFGRU: dataset.productGroups.map((g) => ({
      CODGRUPOPROD: g.code,
      DESCRGRUPOPROD: g.name,
      CODGRUPAI: g.parentCode === null ? ROOT_GROUP_SENTINEL : g.parentCode,
      GRAU: g.degree,
      ANALITICO: flag(g.analytic),
      ATIVO: flag(g.active),
    })),
    TGFNTA: dataset.priceTables.map((t) => ({ CODTAB: t.code, NOMETAB: t.name, ATIVO: flag(t.active) })),
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

/** ERP-shaped TGFCAB / TGFITE rows of the synthetic sales notes (header value, dates and TOP; items with gross and discount). */
export function erpSalesTables(notes: readonly DemoSalesNote[]): ErpTables {
  return {
    TGFCAB: notes.map((n) => ({
      NUNOTA: n.noteId,
      CODPARC: n.customerCode,
      CODVEND: n.sellerCode,
      CODTIPOPER: n.topCode,
      STATUSNOTA: n.status,
      DTNEG: n.negotiationDate,
      DTFATUR: n.billingDate,
      VLRNOTA: Number(n.amount),
    })),
    TGFITE: notes.flatMap((n) =>
      n.items.map((i) => ({ NUNOTA: n.noteId, CODPROD: i.productCode, QTDNEG: Number(i.quantity), VLRTOT: Number(i.gross), VLRDESC: Number(i.discount) })),
    ),
  };
}

const MICRO = 1_000_000;
const micro = (value: unknown): bigint => BigInt(Math.round(Number(value ?? 0) * MICRO));
const fromMicro = (units: bigint): number => Number(units) / MICRO;

/**
 * Interprets ONLY the two sales-history aggregate shapes (GROUP BY) the adapter emits: it parses the filter out of the SQL text
 * (status, TOP, date field, window start), aggregates the TGFCAB / TGFITE rows and pages the result.
 */
function answerSalesHistory(sql: string, tables: ErpTables): HttpResponse | null {
  if (!sql.includes(' GROUP BY ')) return null;
  const isCount = sql.startsWith('SELECT COUNT(*) AS TOTAL FROM (SELECT 1 AS X FROM ');
  const where = /\bWHERE (.+?) GROUP BY /.exec(sql)?.[1];
  if (where === undefined) throw new Error(`mock cannot interpret SQL: ${sql}`);
  const list = (pattern: RegExp): string[] =>
    ((pattern.exec(where)?.[1] ?? '').split(',').map((v) => v.trim().replace(/^'|'$/g, '')).filter((v) => v !== ''));
  const statuses = list(/STATUSNOTA IN \(([^)]*)\)/);
  const tops = list(/CODTIPOPER IN \(([^)]*)\)/).map(Number);
  const field = /\b(DTNEG|DTFATUR) >= TO_DATE/.exec(where)?.[1] ?? 'DTNEG';
  const since = /TO_DATE\('(\d{4}-\d{2}-\d{2})', 'YYYY-MM-DD'\)/.exec(where)?.[1] ?? '';
  const notes = (tables['TGFCAB'] ?? []).filter(
    (row) =>
      Number(row['CODPARC']) > 0 &&
      statuses.includes(String(row['STATUSNOTA'])) &&
      tops.includes(Number(row['CODTIPOPER'])) &&
      typeof row[field] === 'string' &&
      (row[field] as string) >= since,
  );
  const join = sql.includes(' INNER JOIN ');
  const groups = new Map<string, { key: number[]; notes: Set<unknown>; amount: bigint; quantity: bigint; last: string }>();
  if (!join) {
    for (const n of notes) {
      const month = (n[field] as string).slice(0, 7);
      const key = [Number(n['CODPARC']), Number(n['CODVEND'] ?? 0), Number(month.replace('-', '')), Number(n['CODTIPOPER'])];
      const id = key.join('|');
      const g = groups.get(id) ?? { key, notes: new Set(), amount: 0n, quantity: 0n, last: '' };
      g.notes.add(n['NUNOTA']);
      g.amount += micro(n['VLRNOTA']);
      groups.set(id, g);
    }
  } else {
    const byNote = new Map(notes.map((n) => [n['NUNOTA'], n]));
    for (const i of tables['TGFITE'] ?? []) {
      const n = byNote.get(i['NUNOTA']);
      if (n === undefined) continue;
      const key = [Number(n['CODPARC']), Number(i['CODPROD']), Number(n['CODTIPOPER'])];
      const id = key.join('|');
      const date = n[field] as string;
      const g = groups.get(id) ?? { key, notes: new Set(), amount: 0n, quantity: 0n, last: date };
      g.notes.add(n['NUNOTA']);
      g.quantity += micro(i['QTDNEG']);
      g.amount += micro(i['VLRTOT']) - micro(i['VLRDESC']);
      if (date > g.last) g.last = date;
      groups.set(id, g);
    }
  }
  const ordered = [...groups.values()].sort((a, b) => {
    for (let k = 0; k < a.key.length; k += 1) {
      const d = (a.key[k] ?? 0) - (b.key[k] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  if (isCount) return ok(['TOTAL'], [[ordered.length]]);
  const paging = /OFFSET (\d+) ROWS FETCH NEXT (\d+) ROWS ONLY$/.exec(sql);
  if (paging === null) throw new Error(`mock cannot interpret SQL: ${sql}`);
  const page = ordered.slice(Number(paging[1]), Number(paging[1]) + Number(paging[2]));
  if (!join) {
    return ok(
      ['CODPARC', 'CODVEND', 'MES', 'CODTIPOPER', 'QTDNOTAS', 'VLRTOTAL'],
      page.map((g) => {
        const month = String(g.key[2]);
        return [g.key[0], g.key[1], `${month.slice(0, 4)}-${month.slice(4)}`, g.key[3], g.notes.size, fromMicro(g.amount)];
      }),
    );
  }
  return ok(
    ['CODPARC', 'CODPROD', 'CODTIPOPER', 'QTDNOTAS', 'QTD', 'VLRLIQ', 'ULTVENDA'],
    page.map((g) => [g.key[0], g.key[1], g.key[2], g.notes.size, fromMicro(g.quantity), fromMicro(g.amount), g.last]),
  );
}

const SELECT_RE =
  /^SELECT (.+) FROM (\w+)(?: WHERE (.+?))? ORDER BY (.+?) OFFSET (\d+) ROWS FETCH NEXT (\d+) ROWS ONLY$/;
const MEDIA_SIGNATURES_RE =
  /^SELECT CODPROD, DBMS_LOB\.GETLENGTH\(IMAGEM\) AS LEN, .+ FROM TGFPRO WHERE (.+) AND CODPROD > (\d+) AND IMAGEM IS NOT NULL AND DBMS_LOB\.GETLENGTH\(IMAGEM\) > 0 ORDER BY CODPROD FETCH FIRST (\d+) ROWS ONLY$/;
const MEDIA_CHUNK_RE = /^SELECT RAWTOHEX\(DBMS_LOB\.SUBSTR\(IMAGEM, (\d+), (\d+)\)\) AS H FROM TGFPRO WHERE CODPROD = (\d+)$/;
const MEDIA_LENGTH_RE = /^SELECT DBMS_LOB\.GETLENGTH\(IMAGEM\) AS LEN FROM TGFPRO WHERE CODPROD = (\d+)$/;
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
  return where.split(' AND ').every((term) => {
    const flagMatch = /^(\w+) = '(\w)'$/.exec(term);
    if (flagMatch) return row[flagMatch[1] as string] === flagMatch[2];
    const equalsNumber = /^(\w+) = (-?\d+)$/.exec(term);
    if (equalsNumber) return Number(row[equalsNumber[1] as string]) === Number(equalsNumber[2]);
    const isNull = /^(\w+) IS NULL$/.exec(term);
    if (isNull) return row[isNull[1] as string] === null || row[isNull[1] as string] === undefined;
    const isNotNull = /^(\w+) IS NOT NULL$/.exec(term);
    if (isNotNull) return row[isNotNull[1] as string] !== null && row[isNotNull[1] as string] !== undefined;
    const positive = /^(\w+) > 0$/.exec(term);
    if (positive) return Number(row[positive[1] as string]) > 0;
    const inList = /^(\w+) IN \((.+)\)$/.exec(term);
    if (inList) {
      const allowed = (inList[2] as string).split(',').map((v) => v.trim());
      const cell = row[inList[1] as string];
      return allowed.some((v) => (v.startsWith("'") ? cell === v.slice(1, -1) : Number(cell) === Number(v)));
    }
    throw new Error(`mock cannot interpret WHERE: ${where}`);
  });
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
  /** Responses returned (in order) for the next ORDER WRITE calls (mgecom); default: 503. */
  readonly writeResponses: ForcedResponse[] = [];
  /** Runs before each query is answered (tests mutate data or count concurrency here). */
  beforeQuery: ((sql: string) => void | Promise<void>) | undefined;
  /** Synthetic image bytes per CODPROD (the TGFPRO.IMAGEM BLOB stand-in). Mutable by tests. */
  blobs = new Map<number, Uint8Array>();
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
    if (url.pathname === '/gateway/v1/mgecom/service.sbr') return this.#write(request);
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

  #write(request: HttpRequest): HttpResponse | Promise<HttpResponse> {
    this.calls.push({ kind: 'write', url: request.url, body: request.body, at: this.clock.now });
    const token = (request.headers['authorization'] ?? '').replace(/^Bearer /, '');
    const expiresAt = this.#validTokens.get(token);
    if (expiresAt === undefined || this.clock.now >= expiresAt) {
      return { status: 403, headers: {}, body: '{"error":{"codigo":"GTW3403"}}' };
    }
    const forced = this.writeResponses.shift();
    if (forced === undefined) return { status: 503, headers: {}, body: '' };
    return typeof forced === 'function' ? forced(request) : forced;
  }

  writes(): RecordedCall[] {
    return this.calls.filter((call) => call.kind === 'write');
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
    const aggregate = answerSalesHistory(sql, this.tables);
    if (aggregate !== null) return aggregate;
    const signatures = MEDIA_SIGNATURES_RE.exec(sql);
    if (signatures) {
      const [, where, after, limit] = signatures as unknown as [string, string, string, string];
      const rows = (this.tables['TGFPRO'] ?? [])
        .filter(
          (row) =>
            whereMatches(row, where) &&
            Number(row['CODPROD']) > Number(after) &&
            (this.blobs.get(Number(row['CODPROD']))?.length ?? 0) > 0,
        )
        .sort((a, b) => Number(a['CODPROD']) - Number(b['CODPROD']))
        .slice(0, Number(limit))
        .map((row) => {
          const bytes = this.blobs.get(Number(row['CODPROD'])) as Uint8Array;
          const windows = mediaSampleOffsets(bytes.length).map((o) =>
            toHex(bytes.subarray(o - 1, o - 1 + mediaSampleWidth(bytes.length, o))).toUpperCase(),
          );
          return [row['CODPROD'], bytes.length, ...windows];
        });
      return ok(['CODPROD', 'LEN', 'W0', 'W1', 'W2', 'W3', 'W4'], rows);
    }
    const chunk = MEDIA_CHUNK_RE.exec(sql);
    if (chunk) {
      const [, n, offset, code] = chunk as unknown as [string, string, string, string];
      const bytes = this.blobs.get(Number(code));
      if (bytes === undefined) return ok(['H'], []);
      const start = Number(offset) - 1;
      return ok(['H'], [[toHex(bytes.subarray(start, start + Number(n))).toUpperCase()]]);
    }
    const length = MEDIA_LENGTH_RE.exec(sql);
    if (length) {
      const bytes = this.blobs.get(Number(length[1]));
      return ok(['LEN'], bytes === undefined ? [] : [[bytes.length]]);
    }
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
