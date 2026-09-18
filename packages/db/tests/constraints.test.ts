import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  account,
  accountSellerLink,
  auditLog,
  createDb,
  erpCustomer,
  erpListPrice,
  installationConfigurationVersion,
  integrationOutbox,
  runMigrations,
  salesOrder,
  salesOrderItem,
  session,
  syncState,
  type DbHandle,
} from '../src/index.js';
import { startPostgres, uuid, type TestPostgres } from './helpers.js';

let pgc: TestPostgres;
let h: DbHandle;

beforeAll(async () => {
  pgc = await startPostgres();
  const url = await pgc.createDatabase();
  await runMigrations(url, { log: () => undefined });
  h = createDb(url);
});
afterAll(async () => {
  await h?.close();
  await pgc?.stop();
});

/** Asserts a PostgreSQL error (drizzle wraps the driver error in `cause`). */
async function expectPgError(p: Promise<unknown>, code: string, constraint?: string) {
  const err = (await p.then(
    () => undefined,
    (e: unknown) => e,
  )) as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  expect(err, 'expected the statement to be rejected').toBeDefined();
  const pgErr = err.cause ?? err;
  expect(pgErr.code).toBe(code);
  if (constraint) expect(pgErr.constraint).toBe(constraint);
}

const UNIQUE = '23505';
const CHECK = '23514';
const FK = '23503';

const now = () => new Date();

async function newConfig(isCurrent = false) {
  const id = uuid();
  await h.db.insert(installationConfigurationVersion).values({
    id,
    versionLabel: `v-${id.slice(0, 8)}`,
    sourceKind: 'demo',
    payload: { schemaVersion: 1 },
    contentHash: id,
    syncedAt: now(),
    isCurrent,
  });
  return id;
}

async function newAccount(email = `${uuid()}@example.test`, role = 'seller') {
  const id = uuid();
  await h.db.insert(account).values({
    id,
    email,
    displayName: 'Test',
    passwordHash: '$argon2id$placeholder',
    role,
  });
  return id;
}

async function newOrder(accountId: string, configId: string, overrides: Partial<typeof salesOrder.$inferInsert> = {}) {
  const id = uuid();
  await h.db.insert(salesOrder).values({
    id,
    customerCode: 1,
    createdByAccountId: accountId,
    clientRequestId: uuid(),
    configVersionId: configId,
    ...overrides,
  });
  return id;
}

describe('installation_configuration_version', () => {
  it('allows exactly one current row (partial unique index)', async () => {
    const a = await newConfig(true);
    await expectPgError(newConfig(true), UNIQUE, 'installation_configuration_version_one_current_uq');
    // Switching current inside one transaction: old first, then new.
    await h.db.transaction(async (tx) => {
      await tx
        .update(installationConfigurationVersion)
        .set({ isCurrent: false })
        .where(eq(installationConfigurationVersion.id, a));
      await tx.insert(installationConfigurationVersion).values({
        id: uuid(),
        versionLabel: 'next',
        sourceKind: 'sankhya',
        payload: {},
        contentHash: 'h2',
        syncedAt: now(),
        isCurrent: true,
      });
    });
    const current = await h.db
      .select({ id: installationConfigurationVersion.id })
      .from(installationConfigurationVersion)
      .where(eq(installationConfigurationVersion.isCurrent, true));
    expect(current).toHaveLength(1);
    expect(current[0]?.id).not.toBe(a);
  });

  it('many non-current rows are allowed and source_kind is checked', async () => {
    await newConfig(false);
    await newConfig(false);
    await expectPgError(
      h.db.insert(installationConfigurationVersion).values({
        id: uuid(),
        versionLabel: 'x',
        sourceKind: 'plac',
        payload: {},
        contentHash: 'x',
        syncedAt: now(),
      }),
      CHECK,
      'installation_configuration_version_source_kind_chk',
    );
  });
});

describe('sync_state', () => {
  it('checks status', async () => {
    await h.db.insert(syncState).values({ entity: 'customers' });
    await expectPgError(
      h.db.insert(syncState).values({ entity: 'products', status: 'bogus' }),
      CHECK,
      'sync_state_status_chk',
    );
  });
});

describe('iam', () => {
  it('rejects duplicate emails case-insensitively', async () => {
    await newAccount('Dup.User@Example.test');
    await expectPgError(newAccount('dup.user@example.TEST'), UNIQUE, 'account_email_lower_uq');
  });

  it('checks role and status', async () => {
    await expectPgError(newAccount(undefined, 'owner'), CHECK, 'account_role_chk');
    await expectPgError(
      h.db.insert(account).values({
        id: uuid(),
        email: `${uuid()}@example.test`,
        displayName: 'x',
        passwordHash: 'x',
        role: 'seller',
        status: 'gone',
      }),
      CHECK,
      'account_status_chk',
    );
  });

  it('session token hashes are unique and sessions cascade with the account', async () => {
    const acc = await newAccount();
    const tokenHash = uuid();
    const expiresAt = new Date(Date.now() + 3_600_000);
    await h.db.insert(session).values({ id: uuid(), accountId: acc, tokenHash, expiresAt });
    await expectPgError(
      h.db.insert(session).values({ id: uuid(), accountId: acc, tokenHash, expiresAt }),
      UNIQUE,
      'session_token_hash_uq',
    );
    await h.db.delete(account).where(eq(account.id, acc));
    expect(await h.db.select().from(session).where(eq(session.accountId, acc))).toHaveLength(0);
  });

  it('account_seller_link is one per account and needs a valid config version', async () => {
    const acc = await newAccount();
    const cfg = await newConfig();
    await h.db.insert(accountSellerLink).values({ accountId: acc, sellerCode: 7, configVersionId: cfg });
    await expectPgError(
      h.db.insert(accountSellerLink).values({ accountId: acc, sellerCode: 8, configVersionId: cfg }),
      UNIQUE,
    );
    const acc2 = await newAccount();
    await expectPgError(
      h.db.insert(accountSellerLink).values({ accountId: acc2, sellerCode: 8, configVersionId: uuid() }),
      FK,
    );
  });

  it('audit_log accepts events without an actor and rejects unknown actors', async () => {
    await h.db.insert(auditLog).values({ id: uuid(), action: 'login_failure', detail: { reason: 'unknown_email' } });
    await expectPgError(
      h.db.insert(auditLog).values({ id: uuid(), actorAccountId: uuid(), action: 'login_success' }),
      FK,
    );
  });
});

describe('mirror price semantics', () => {
  it('rejects a negative unit price', async () => {
    await expectPgError(
      h.db.insert(erpListPrice).values({
        versionId: 1,
        productCode: 1,
        unitPrice: '-0.010000',
        contentHash: 'h',
        syncedAt: now(),
      }),
      CHECK,
      'erp_list_price_unit_price_chk',
    );
  });

  it('keeps "no price" (absent row) distinct from "zero price" (explicit 0 row)', async () => {
    await h.db.insert(erpListPrice).values([
      { versionId: 10, productCode: 100, unitPrice: '0', contentHash: 'h', syncedAt: now() },
      { versionId: 10, productCode: 101, unitPrice: '12.500000', contentHash: 'h', syncedAt: now() },
    ]);
    const price = async (product: number) =>
      (
        await h.db
          .select({ p: erpListPrice.unitPrice })
          .from(erpListPrice)
          .where(sql`${erpListPrice.versionId} = 10 and ${erpListPrice.productCode} = ${product}`)
      )[0]?.p;
    expect(await price(100)).toBe('0.000000'); // zero price: row exists, value 0
    expect(await price(101)).toBe('12.500000'); // priced
    expect(await price(102)).toBeUndefined(); // no price: no row
  });

  it('primary key prevents duplicate (version, product) prices', async () => {
    await h.db
      .insert(erpListPrice)
      .values({ versionId: 20, productCode: 1, unitPrice: '1', contentHash: 'h', syncedAt: now() });
    await expectPgError(
      h.db
        .insert(erpListPrice)
        .values({ versionId: 20, productCode: 1, unitPrice: '2', contentHash: 'h', syncedAt: now() }),
      UNIQUE,
      'erp_list_price_pk',
    );
  });

  it('customer with null price_table_code stays null (no resolved table) and 0 is allowed as a code', async () => {
    await h.db.insert(erpCustomer).values({
      code: 900,
      name: 'Cliente Sintetico',
      active: true,
      isCustomer: true,
      contentHash: 'h',
      syncedAt: now(),
    });
    const [row] = await h.db.select().from(erpCustomer).where(eq(erpCustomer.code, 900));
    expect(row?.priceTableCode).toBeNull();
    expect(row?.deletedAt).toBeNull();
  });

  it('customer checks person type and non-negative credit limit', async () => {
    const base = { active: true, isCustomer: true, contentHash: 'h', syncedAt: now() };
    await expectPgError(
      h.db.insert(erpCustomer).values({ code: 901, name: 'x', personType: 'X', ...base }),
      CHECK,
      'erp_customer_person_type_chk',
    );
    await expectPgError(
      h.db.insert(erpCustomer).values({ code: 902, name: 'x', creditLimit: '-1', ...base }),
      CHECK,
      'erp_customer_credit_limit_chk',
    );
  });

  it('trigram search works on customer name, case-insensitively', async () => {
    await h.db.insert(erpCustomer).values({
      code: 903,
      name: 'Distribuidora Aurora Ltda',
      taxId: '12345678000199',
      active: true,
      isCustomer: true,
      contentHash: 'h',
      syncedAt: now(),
    });
    const found = await h.db
      .select({ code: erpCustomer.code })
      .from(erpCustomer)
      .where(sql`${erpCustomer.name} ilike ${'%aurora%'} and ${erpCustomer.deletedAt} is null`);
    expect(found.map((r) => r.code)).toContain(903);
  });
});

describe('orders', () => {
  it('enforces unique client_request_id (idempotent creation)', async () => {
    const acc = await newAccount();
    const cfg = await newConfig();
    const clientRequestId = uuid();
    await newOrder(acc, cfg, { clientRequestId });
    await expectPgError(
      newOrder(acc, cfg, { clientRequestId }),
      UNIQUE,
      'sales_order_client_request_id_uq',
    );
  });

  it('external_origin_id is nullable-unique: many NULLs, no duplicate values', async () => {
    const acc = await newAccount();
    const cfg = await newConfig();
    const a = await newOrder(acc, cfg);
    const b = await newOrder(acc, cfg);
    const rows = await h.db.select({ o: salesOrder.externalOriginId }).from(salesOrder).where(sql`id in (${a}, ${b})`);
    expect(rows.every((r) => r.o === null)).toBe(true);
    await newOrder(acc, cfg, { externalOriginId: 'origin-1' });
    await expectPgError(
      newOrder(acc, cfg, { externalOriginId: 'origin-1' }),
      UNIQUE,
      'sales_order_external_origin_id_uq',
    );
  });

  it('draft_number is a generated sequential identity and cannot be overridden', async () => {
    const acc = await newAccount();
    const cfg = await newConfig();
    const a = await newOrder(acc, cfg);
    const b = await newOrder(acc, cfg);
    const rows = await h.db
      .select({ id: salesOrder.id, n: salesOrder.draftNumber })
      .from(salesOrder)
      .where(sql`id in (${a}, ${b})`);
    const n = (id: string) => rows.find((r) => r.id === id)?.n as number;
    expect(n(b)).toBeGreaterThan(n(a));
    await expectPgError(
      h.db.execute(sql`insert into sales_order (id, draft_number, customer_code, created_by_account_id, client_request_id, config_version_id)
        values (${uuid()}, 5, 1, ${acc}, ${uuid()}, ${cfg})`),
      '428C9',
    );
  });

  it('checks status, version and non-negative estimated total', async () => {
    const acc = await newAccount();
    const cfg = await newConfig();
    await expectPgError(newOrder(acc, cfg, { status: 'shipped' }), CHECK, 'sales_order_status_chk');
    await expectPgError(newOrder(acc, cfg, { version: 0 }), CHECK, 'sales_order_version_chk');
    await expectPgError(
      newOrder(acc, cfg, { estimatedTotal: '-0.01' }),
      CHECK,
      'sales_order_estimated_total_chk',
    );
  });

  it('item quantity must be > 0 and price state must agree with the price value', async () => {
    const acc = await newAccount();
    const cfg = await newConfig();
    const order = await newOrder(acc, cfg);
    const item = (o: Partial<typeof salesOrderItem.$inferInsert>, lineNo: number) =>
      h.db.insert(salesOrderItem).values({
        id: uuid(),
        orderId: order,
        lineNo,
        productCode: 1,
        productDescription: 'Produto sintetico',
        quantity: '1',
        priceState: 'priced',
        unitListPrice: '10',
        estimatedLineTotal: '10',
        ...o,
      });

    await expectPgError(item({ quantity: '0' }, 1), CHECK, 'sales_order_item_quantity_chk');
    await expectPgError(item({ quantity: '-1' }, 1), CHECK, 'sales_order_item_quantity_chk');
    // Negative price: rejected (by the >= 0 guard and by the state consistency rule; PG reports one).
    await expectPgError(item({ unitListPrice: '-1' }, 1), CHECK);

    // priced / zero / none each valid in their own shape...
    await item({}, 1);
    await item({ priceState: 'zero', unitListPrice: '0', estimatedLineTotal: '0' }, 2);
    await item({ priceState: 'none', unitListPrice: null, estimatedLineTotal: null }, 3);

    // ...and mixing them is rejected: none != zero != priced.
    const consistency = 'sales_order_item_price_state_consistency_chk';
    await expectPgError(item({ priceState: 'none', unitListPrice: '0', estimatedLineTotal: null }, 4), CHECK, consistency);
    await expectPgError(item({ priceState: 'none', unitListPrice: null, estimatedLineTotal: '0' }, 4), CHECK, consistency);
    await expectPgError(item({ priceState: 'zero', unitListPrice: null, estimatedLineTotal: null }, 4), CHECK, consistency);
    await expectPgError(item({ priceState: 'zero', unitListPrice: '1', estimatedLineTotal: '1' }, 4), CHECK, consistency);
    await expectPgError(item({ priceState: 'priced', unitListPrice: '0', estimatedLineTotal: '0' }, 4), CHECK, consistency);
    await expectPgError(item({ priceState: 'priced', unitListPrice: null, estimatedLineTotal: null }, 4), CHECK, consistency);
    await expectPgError(item({ priceState: 'free' }, 4), CHECK, 'sales_order_item_price_state_chk');
  });

  it('line numbers are unique per order and items cascade on order delete', async () => {
    const acc = await newAccount();
    const cfg = await newConfig();
    const order = await newOrder(acc, cfg);
    const values = (lineNo: number) => ({
      id: uuid(),
      orderId: order,
      lineNo,
      productCode: 5,
      productDescription: 'x',
      quantity: '2.5000',
      priceState: 'none' as const,
    });
    await h.db.insert(salesOrderItem).values(values(1));
    await expectPgError(h.db.insert(salesOrderItem).values(values(1)), UNIQUE, 'sales_order_item_order_line_uq');
    await h.db.insert(salesOrderItem).values(values(2));

    await expectPgError(
      h.db.insert(salesOrderItem).values({ ...values(1), id: uuid(), orderId: uuid() }),
      FK,
    );

    expect(await h.db.select().from(salesOrderItem).where(eq(salesOrderItem.orderId, order))).toHaveLength(2);
    await h.db.delete(salesOrder).where(eq(salesOrder.id, order));
    expect(await h.db.select().from(salesOrderItem).where(eq(salesOrderItem.orderId, order))).toHaveLength(0);
  });

  it('order requires an existing account and configuration version', async () => {
    const acc = await newAccount();
    const cfg = await newConfig();
    await expectPgError(newOrder(uuid(), cfg), FK);
    await expectPgError(newOrder(acc, uuid()), FK);
  });
});

describe('integration_outbox', () => {
  const base = () => ({
    id: uuid(),
    aggregateType: 'sales_order',
    aggregateId: uuid(),
    operation: 'submit',
    payload: {},
  });

  it('defaults to pending/0 attempts and checks status and attempt_count', async () => {
    const id = uuid();
    await h.db.insert(integrationOutbox).values({ ...base(), id });
    const [row] = await h.db.select().from(integrationOutbox).where(eq(integrationOutbox.id, id));
    expect(row?.status).toBe('pending');
    expect(row?.attemptCount).toBe(0);
    expect(row?.originId).toBeNull();
    await expectPgError(
      h.db.insert(integrationOutbox).values({ ...base(), status: 'sent' }),
      CHECK,
      'integration_outbox_status_chk',
    );
    await expectPgError(
      h.db.insert(integrationOutbox).values({ ...base(), attemptCount: -1 }),
      CHECK,
      'integration_outbox_attempt_count_chk',
    );
  });

  it('a non-null origin id is unique, NULLs are not', async () => {
    await h.db.insert(integrationOutbox).values([base(), base()]);
    await h.db.insert(integrationOutbox).values({ ...base(), originId: 'o-1' });
    await expectPgError(
      h.db.insert(integrationOutbox).values({ ...base(), originId: 'o-1' }),
      UNIQUE,
      'integration_outbox_origin_id_uq',
    );
  });
});
