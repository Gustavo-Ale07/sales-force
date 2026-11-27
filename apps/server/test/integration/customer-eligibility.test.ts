import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { customerOrderBlock, type InstallationConfiguration } from '@salesforce/domain';
import { erpCustomer } from '@salesforce/db';
import { DEMO_CONFIGURATION, FakeGateway, getDemoDataset, SankhyaGatewayError, type DemoDataset } from '@salesforce/sankhya';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eligibleCustomerConditions, isBlockedRaw, MirrorRepository } from '../../src/mirror/mirror.repository.js';
import { createLogger } from '../../src/observability/logger.js';
import { deriveReadScope } from '../../src/sync/mirror-scope.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Single customer-eligibility rule (Item 1). `eligibleCustomerConditions()` (list, search, file, count, price tables and the
 * device pull) must agree with the domain `customerOrderBlock` on active / blocked / deleted / is_customer, and DELIBERATELY
 * not filter by seller (owner ruling 2026-11-13: a customer without a seller stays listed with the "Sem vendedor" seal and
 * cannot be ordered). A customer that stops being eligible leaves the mirror's live set through the missing-row rule.
 */

const dataset = getDemoDataset();
const hashOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SYNCED = new Date('2026-11-20T00:00:00.000Z');
const TABLE = 21;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let repository: MirrorRepository;
let items: { productCode: unknown; quantity: string }[];

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  repository = new MirrorRepository(ctx.database.handle.db);
  const list: Json[] = (await ctx.call('manager', 'GET', `/products?customerCode=${dataset.customers.find((c) => c.priceTableCode === TABLE && c.active && !c.blocked)!.code}&pageSize=100&sellable=true&priceState=priced`)).body.items;
  items = list.slice(0, 2).map((p) => ({ productCode: p.code, quantity: '1' }));
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const db = () => ctx.database.handle.db;
type Insert = typeof erpCustomer.$inferInsert;
const insert = (code: number, over: Partial<Insert>) =>
  db()
    .insert(erpCustomer)
    .values({
      code,
      name: `ELEGIBILIDADE ${code}`,
      active: true,
      isCustomer: true,
      blockedRaw: 'N',
      sellerCode: 103,
      priceTableCode: TABLE,
      contentHash: hashOf(code),
      syncedAt: SYNCED,
      ...over,
    });
const eligibleCodes = async (codes: number[]): Promise<number[]> =>
  (await db().select({ code: erpCustomer.code }).from(erpCustomer).where(and(...eligibleCustomerConditions(), inArray(erpCustomer.code, codes)))).map((r) => r.code).sort((a, b) => a - b);

describe('eligibleCustomerConditions() parity with the domain customerOrderBlock', () => {
  const actives = [true, false];
  const blockedRaws = [null, 'N', 'S', 's', ' 1 ', 'TRUE', 'false'];
  const deletions = [false, true];
  const customerFlags = [true, false];
  const sellers = [null, 0, 1, 103];
  const rows: { code: number; active: boolean; blockedRaw: string | null; deleted: boolean; isCustomer: boolean; sellerCode: number | null }[] = [];
  let code = 800_000;
  for (const active of actives) for (const blockedRaw of blockedRaws) for (const deleted of deletions) for (const isCustomer of customerFlags) for (const sellerCode of sellers) rows.push({ code: code++, active, blockedRaw, deleted, isCustomer, sellerCode });

  beforeAll(async () => {
    for (let i = 0; i < rows.length; i += 100) {
      await db()
        .insert(erpCustomer)
        .values(
          rows.slice(i, i + 100).map((r) => ({
            code: r.code,
            name: `PARIDADE ${r.code}`,
            active: r.active,
            isCustomer: r.isCustomer,
            blockedRaw: r.blockedRaw,
            sellerCode: r.sellerCode,
            deletedAt: r.deleted ? SYNCED : null,
            contentHash: hashOf(r.code),
            syncedAt: SYNCED,
          })),
        );
    }
  });

  it('lists exactly the live customers the domain accepts when the seller is ignored (blocked/inactive/deleted/non-customer out, seller-less in)', async () => {
    const listed = new Set(await eligibleCodes(rows.map((r) => r.code)));
    expect(rows.length).toBe(2 * 7 * 2 * 2 * 4);
    for (const r of rows) {
      const domainOk = !r.deleted && r.isCustomer && customerOrderBlock({ active: r.active, blocked: isBlockedRaw(r.blockedRaw), sellerCode: 1 }) === null;
      expect(listed.has(r.code), JSON.stringify(r)).toBe(domainOk);
    }
  });

  it('the only divergence from "can receive an order" is the seller: listed but customer_without_seller (null and 0)', async () => {
    const listed = new Set(await eligibleCodes(rows.map((r) => r.code)));
    for (const r of rows.filter((x) => listed.has(x.code))) {
      const block = customerOrderBlock({ active: r.active, blocked: isBlockedRaw(r.blockedRaw), sellerCode: r.sellerCode });
      expect(block, JSON.stringify(r)).toBe(r.sellerCode === null || r.sellerCode < 1 ? 'customer_without_seller' : null);
    }
    expect([...listed].some((c) => rows.find((r) => r.code === c)?.sellerCode === null)).toBe(true);
    expect([...listed].some((c) => rows.find((r) => r.code === c)?.sellerCode === 0)).toBe(true);
  });
});

describe('every customer source uses the same rule (list, search, file, count, price tables, device pull)', () => {
  const OK = 810_001; // eligible, seller 103
  const NO_SELLER = 810_002; // 5020-like: active CLIENTE, seller null
  const ZERO_SELLER = 810_003;
  const BLOCKED = 810_004;
  const INACTIVE = 810_005;
  const DELETED = 810_006;
  const NOT_CUSTOMER = 810_007;
  const TABLE_ELIGIBLE = 9_810;
  const TABLE_INELIGIBLE_ONLY = 9_811;
  const visible = [OK, NO_SELLER, ZERO_SELLER];
  const hidden = [BLOCKED, INACTIVE, DELETED, NOT_CUSTOMER];
  let totalBefore: number;
  let withoutTableBefore: number;

  beforeAll(async () => {
    const counts = await repository.countCustomers({ kind: 'all' });
    totalBefore = counts.total;
    withoutTableBefore = counts.withoutPriceTable;
    await insert(OK, { name: 'FONTES OK' });
    await insert(NO_SELLER, { name: 'FONTES SEM VENDEDOR', sellerCode: null, priceTableCode: TABLE_ELIGIBLE });
    await insert(ZERO_SELLER, { name: 'FONTES VENDEDOR ZERO', sellerCode: 0, priceTableCode: null });
    await insert(BLOCKED, { name: 'FONTES BLOQUEADO', blockedRaw: 'S', priceTableCode: TABLE_INELIGIBLE_ONLY });
    await insert(INACTIVE, { name: 'FONTES INATIVO', active: false, priceTableCode: TABLE_INELIGIBLE_ONLY });
    await insert(DELETED, { name: 'FONTES REMOVIDO', deletedAt: SYNCED, priceTableCode: TABLE_INELIGIBLE_ONLY });
    await insert(NOT_CUSTOMER, { name: 'FONTES FORNECEDOR', isCustomer: false, priceTableCode: TABLE_INELIGIBLE_ONLY });
  });

  const names = (body: Json) => (body.items as Json[]).map((c) => c.code as number);

  it('list and search include the seller-less customers (null and 0) and exclude blocked/inactive/deleted/non-customer', async () => {
    const listed = names((await ctx.call('manager', 'GET', '/customers?search=FONTES&pageSize=100')).body);
    expect(listed.sort()).toEqual([...visible].sort());
    const seller = (await ctx.call('manager', 'GET', '/customers?search=FONTES%20SEM%20VENDEDOR&pageSize=100')).body.items as Json[];
    expect(seller).toHaveLength(1);
    expect(seller[0]).toMatchObject({ code: NO_SELLER, sellerCode: null, active: true, blocked: false });
    for (const hiddenName of ['BLOQUEADO', 'INATIVO', 'REMOVIDO', 'FORNECEDOR']) {
      expect((await ctx.call('manager', 'GET', `/customers?search=FONTES%20${hiddenName}&pageSize=100`)).body.items).toEqual([]);
    }
  });

  it('the customer file: 200 for the seller-less one, 404 for every hidden one', async () => {
    for (const code of visible) expect((await ctx.call('manager', 'GET', `/customers/${code}`)).status).toBe(200);
    for (const code of hidden) expect((await ctx.call('manager', 'GET', `/customers/${code}`)).status).toBe(404);
  });

  it('a seller scope never reaches a seller-less customer (no widening)', async () => {
    const mine = (await ctx.call('seller1', 'GET', '/customers?search=FONTES&pageSize=100')).body;
    expect(names(mine)).not.toContain(NO_SELLER);
    expect(names(mine)).not.toContain(ZERO_SELLER);
    expect((await ctx.call('seller1', 'GET', `/customers/${NO_SELLER}`)).status).toBe(404);
  });

  it('the count includes the three visible customers and none of the hidden ones', async () => {
    const counts = await repository.countCustomers({ kind: 'all' });
    expect(counts.total - totalBefore).toBe(3);
    // OK has table 21, NO_SELLER has 9810, ZERO_SELLER has none.
    expect(counts.withoutPriceTable - withoutTableBefore).toBe(1);
  });

  it('price tables in scope come only from eligible customers (a blocked/inactive/deleted/non-customer table is not served)', async () => {
    const inScope = await repository.priceTableCodesInScope({ kind: 'all' });
    expect(inScope.codes).toContain(TABLE_ELIGIBLE);
    expect(inScope.codes).not.toContain(TABLE_INELIGIBLE_ONLY);
    expect(inScope.hasWithoutTable).toBe(true);
  });

  it('the device pull (paged list the app caches) carries the same set: seller-less in, hidden out', async () => {
    const pulled: number[] = [];
    for (let page = 1; ; page += 1) {
      const body = (await ctx.call('manager', 'GET', `/customers?page=${page}&pageSize=100&sort=name`)).body;
      pulled.push(...names(body));
      if (pulled.length >= body.total || (body.items as Json[]).length === 0) break;
    }
    for (const code of visible) expect(pulled).toContain(code);
    for (const code of hidden) expect(pulled).not.toContain(code);
    expect(new Set(pulled).size).toBe(pulled.length);
  });
});

describe('orders for a customer without a seller (409 with the structured reason)', () => {
  const NO_SELLER = 820_001;
  const ZERO_SELLER = 820_002;
  const body = (customerCode: number) => ({ clientRequestId: randomUUID(), customerCode, negotiationTypeCode: null, notes: null, items });

  beforeAll(async () => {
    await insert(NO_SELLER, { name: 'PEDIDO SEM VENDEDOR', sellerCode: null });
    await insert(ZERO_SELLER, { name: 'PEDIDO VENDEDOR ZERO', sellerCode: 0 });
  });

  it.each([
    ['null', 820_001],
    ['0', 820_002],
  ] as const)('create is refused with 409 customer_without_seller and details.reason (seller %s); nothing is stored', async (_label, code) => {
    const response = await ctx.call('manager', 'POST', '/orders', body(code));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('customer_without_seller');
    expect(response.body.details).toMatchObject({ reason: 'customer_without_seller' });
    const listed: Json[] = (await ctx.call('manager', 'GET', '/orders?pageSize=100')).body.items;
    expect(listed.some((o) => o.customerCode === code)).toBe(false);
  });

  it('replace to a seller-less customer is refused with the same 409 and the draft is untouched', async () => {
    const normal = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === TABLE)!;
    const created = await ctx.call('manager', 'POST', '/orders', body(normal.code));
    expect(created.status).toBe(201);
    const { clientRequestId: _ignored, ...rest } = body(NO_SELLER);
    const response = await ctx.call('manager', 'PUT', `/orders/${created.body.id}`, { ...rest, expectedVersion: created.body.version });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('customer_without_seller');
    expect(response.body.details.reason).toBe('customer_without_seller');
    expect((await ctx.call('manager', 'GET', `/orders/${created.body.id}`)).body.version).toBe(created.body.version);
  });

  it('send revalidates now: a draft whose customer lost the seller is refused (409 customer_ineligible, reason customer_without_seller) and flagged', async () => {
    const normal = dataset.customers.filter((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === TABLE)[1]!;
    const created = await ctx.call('manager', 'POST', '/orders', body(normal.code));
    expect(created.status).toBe(201);
    await db().update(erpCustomer).set({ sellerCode: null }).where(eq(erpCustomer.code, normal.code));
    try {
      const submit = await ctx.call('manager', 'POST', `/orders/${created.body.id}/submit`);
      expect(submit.status).toBe(409);
      expect(submit.body.code).toBe('customer_ineligible');
      expect(submit.body.details.reason).toBe('customer_without_seller');
      expect((await ctx.call('manager', 'GET', `/orders/${created.body.id}`)).body.review).toEqual({ status: 'needs_review', reason: 'customer_ineligible', customerBlock: 'customer_without_seller' });
    } finally {
      await db().update(erpCustomer).set({ sellerCode: 103 }).where(eq(erpCustomer.code, normal.code));
    }
  });
});

/* ---------- eligibility changes at the source: the mirror deactivates, the API follows ---------- */

type Mutable = { -readonly [K in keyof DemoDataset]: DemoDataset[K][number][] };
function datasetCopy(): Mutable {
  const s = getDemoDataset();
  return {
    sellers: [...s.sellers],
    sellerManagerLinks: [...s.sellerManagerLinks],
    directoryUsers: [...s.directoryUsers],
    carriers: [...s.carriers],
    cities: [...s.cities],
    neighborhoods: [...s.neighborhoods],
    streets: [...s.streets],
    postalCodes: [...s.postalCodes],
    sellerGoals: [...s.sellerGoals],
    forceConfig: [...s.forceConfig],
    forceDiscountLimits: [...s.forceDiscountLimits],
    ipiRates: [...s.ipiRates],
    openTitles: [...s.openTitles],
    customers: [...s.customers],
    productGroups: [...s.productGroups],
    products: [...s.products],
    priceTables: [...s.priceTables],
    priceTableVersions: [...s.priceTableVersions],
    listPrices: [...s.listPrices],
  };
}

describe('a customer that becomes ineligible at the source (mirror deactivation, API and device pull follow)', () => {
  let app: CommercialApp;
  const configWith = (columnIn: { column: string; values: string[] }[]): InstallationConfiguration => ({
    ...DEMO_CONFIGURATION,
    customers: { ...DEMO_CONFIGURATION.customers, eligibility: { activeOnly: true, requiredFlags: ['CLIENTE'], columnIn } },
  });
  const data = datasetCopy();
  const base = data.customers[0]!;
  const A = 830_001;
  const B = 830_002;
  const C = 830_003;
  const mk = (code: number, over: Record<string, unknown> = {}) => ({ ...base, code, name: `MIRROR ${code}`, active: true, blocked: false, sellerCode: 103, sourceAttributes: { CLASSIFICMS: 'R' }, ...over });

  beforeAll(async () => {
    app = await startCommercialApp(postgres, opened, { seedMirror: false });
  });

  const sync = (config: InstallationConfiguration, customers: unknown[]) => {
    data.customers = customers as never;
    return new MirrorSyncService({
      db: app.database.handle,
      gateway: new FakeGateway({ dataset: data as DemoDataset }),
      logger: createLogger({ level: 'silent', service: 'worker' }),
      now: () => new Date(),
      readScope: async () => deriveReadScope(config),
    }).run('customers');
  };
  const listed = async () => ((await app.call('manager', 'GET', '/customers?search=MIRROR&pageSize=100')).body.items as Json[]).map((c) => c.code as number).sort();
  const pulled = async () => {
    const out: number[] = [];
    for (let page = 1; ; page += 1) {
      const body = (await app.call('manager', 'GET', `/customers?page=${page}&pageSize=100&sort=name`)).body;
      out.push(...(body.items as Json[]).map((c) => c.code as number));
      if (out.length >= body.total || (body.items as Json[]).length === 0) break;
    }
    return out;
  };
  const deletedAt = async (code: number) => (await app.database.handle.db.select({ d: erpCustomer.deletedAt }).from(erpCustomer).where(eq(erpCustomer.code, code)))[0]?.d ?? null;

  it('blocked at the source: stays in the mirror (orders still read its reason) but leaves list, search, file and device pull', async () => {
    const config = configWith([{ column: 'CLASSIFICMS', values: ['R'] }]);
    await sync(config, [mk(A), mk(B), mk(C, { sellerCode: null })]);
    expect(await listed()).toEqual([A, B, C]);
    expect(await pulled()).toEqual(expect.arrayContaining([A, B, C]));

    await sync(config, [mk(A), mk(B, { blocked: true }), mk(C, { sellerCode: null })]);
    expect(await deletedAt(B)).toBeNull();
    expect(await listed()).toEqual([A, C]);
    expect(await pulled()).not.toContain(B);
    expect((await app.call('manager', 'GET', `/customers/${B}`)).status).toBe(404);
    expect((await app.call('manager', 'GET', `/customers/${C}`)).status).toBe(200);
  });

  it('no longer matching customers.eligibility (columnIn): deactivated by the mirror, gone from list/search/file/device pull; returns when it matches again', async () => {
    const config = configWith([{ column: 'CLASSIFICMS', values: ['R'] }]);
    const result = await sync(config, [mk(A), mk(B), mk(C, { sourceAttributes: { CLASSIFICMS: 'C' } })]);
    expect(result.stats).toMatchObject({ deactivated: 1 });
    expect(result.excluded).toEqual({ 'column:CLASSIFICMS': 1 });
    expect(await deletedAt(C)).not.toBeNull();
    expect(await listed()).toEqual([A, B]);
    expect(await pulled()).not.toContain(C);
    expect((await app.call('manager', 'GET', `/customers/${C}`)).status).toBe(404);
    expect((await app.call('manager', 'GET', '/customers?search=MIRROR%20830003&pageSize=10')).body.items).toEqual([]);

    const back = await sync(config, [mk(A), mk(B), mk(C)]);
    expect(back.stats).toMatchObject({ deactivated: 0 });
    expect(await deletedAt(C)).toBeNull();
    expect(await listed()).toEqual([A, B, C]);
  });

  it('the eligibility rule comes from the installation configuration, never from literals: the same source rows flip with the configured values', async () => {
    const rows = [mk(A), mk(B, { sourceAttributes: { CLASSIFICMS: 'X' } }), mk(C, { sourceAttributes: { CLASSIFICMS: 'X' } })];
    await sync(configWith([{ column: 'CLASSIFICMS', values: ['R'] }]), rows);
    expect(await listed()).toEqual([A]);
    await sync(configWith([{ column: 'CLASSIFICMS', values: ['X'] }]), rows);
    expect(await listed()).toEqual([B, C]);
    expect(await deletedAt(A)).not.toBeNull();
    // Without any columnIn the CLIENTE/active rule alone applies.
    await sync(configWith([]), rows);
    expect(await listed()).toEqual([A, B, C]);
  });

  it('inactive at the source (activeOnly): leaves the mirror live set like a removed one, never hard-deleted', async () => {
    const config = configWith([]);
    await sync(config, [mk(A), mk(B, { active: false }), mk(C)]);
    expect(await deletedAt(B)).not.toBeNull();
    expect(await listed()).toEqual([A, C]);
    const { rows } = await app.database.handle.pool.query<{ n: number }>('select count(*)::int as n from erp_customer where code = $1', [B]);
    expect(rows[0]?.n).toBe(1);
  });

  it('the empty-snapshot guard still refuses to deactivate everything (empty source, or a rule that leaves nobody)', async () => {
    const config = configWith([{ column: 'CLASSIFICMS', values: ['R'] }]);
    await sync(config, [mk(A), mk(B), mk(C)]);
    const before = await listed();
    expect(before).toEqual([A, B, C]);

    await expect(sync(config, [])).rejects.toMatchObject({ code: 'empty_snapshot' });
    expect(await listed()).toEqual(before);

    // Rows exist at the source but the rule excludes all of them: still fails closed, nothing is deactivated.
    await expect(sync(config, [mk(A, { sourceAttributes: { CLASSIFICMS: 'C' } }), mk(B, { sourceAttributes: { CLASSIFICMS: 'C' } }), mk(C, { sourceAttributes: { CLASSIFICMS: 'C' } })])).rejects.toBeInstanceOf(
      Error,
    );
    expect(await listed()).toEqual(before);
    expect(await deletedAt(A)).toBeNull();
    void SankhyaGatewayError;
  });
});
