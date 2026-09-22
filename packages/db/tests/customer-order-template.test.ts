import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  account,
  createDb,
  customerOrderTemplate,
  customerOrderTemplateItem,
  runMigrations,
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
const NOT_NULL = '23502';

const now = () => new Date();

async function newAccount() {
  const id = uuid();
  await h.db.insert(account).values({
    id,
    email: `${id}@example.test`,
    displayName: 'Test',
    passwordHash: '$argon2id$placeholder',
    role: 'seller',
  });
  return id;
}

async function newTemplate(
  accountId: string,
  overrides: Partial<typeof customerOrderTemplate.$inferInsert> = {},
) {
  const id = uuid();
  await h.db.insert(customerOrderTemplate).values({
    id,
    customerCode: 7001,
    name: `t-${id}`,
    createdByAccountId: accountId,
    clientRequestId: uuid(),
    requestHash: 'a'.repeat(64),
    ...overrides,
  });
  return id;
}

const softDelete = (id: string) =>
  h.db.update(customerOrderTemplate).set({ deletedAt: now() }).where(eq(customerOrderTemplate.id, id));

describe('customer_order_template', () => {
  it('applies defaults (version 1, timestamps, not deleted)', async () => {
    const acc = await newAccount();
    const id = await newTemplate(acc);
    const [row] = await h.db.select().from(customerOrderTemplate).where(eq(customerOrderTemplate.id, id));
    expect(row?.version).toBe(1);
    expect(row?.deletedAt).toBeNull();
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('requires an existing account (FK) and has no FK on customer_code', async () => {
    await expectPgError(
      newTemplate(uuid()),
      FK,
      'customer_order_template_created_by_account_id_account_id_fk',
    );
    // customer_code 999999 is not in erp_customer: accepted (mirror rows are never referenced).
    const acc = await newAccount();
    await newTemplate(acc, { customerCode: 999_999 });
  });

  it('rejects blank and over-long names, accepts exactly 80 characters', async () => {
    const acc = await newAccount();
    for (const name of ['', '   ', '\t\n']) {
      await expectPgError(newTemplate(acc, { name }), CHECK, 'customer_order_template_name_chk');
    }
    await expectPgError(
      newTemplate(acc, { name: 'x'.repeat(81) }),
      CHECK,
      'customer_order_template_name_chk',
    );
    await newTemplate(acc, { customerCode: 7102, name: 'ç'.repeat(80) });
  });

  it('rejects version below 1', async () => {
    const acc = await newAccount();
    await expectPgError(newTemplate(acc, { version: 0 }), CHECK, 'customer_order_template_version_chk');
  });

  it('requires a request hash', async () => {
    const acc = await newAccount();
    await expectPgError(
      h.db.execute(
        sql`insert into customer_order_template (id, customer_code, name, created_by_account_id, client_request_id)
            values (${uuid()}, 7400, 'x', ${acc}, ${uuid()})`,
      ),
      NOT_NULL,
    );
  });

  it('live names are unique per customer, case-insensitively; deleted names are reusable', async () => {
    const acc = await newAccount();
    const first = await newTemplate(acc, { customerCode: 7200, name: 'Mensal' });
    await expectPgError(
      newTemplate(acc, { customerCode: 7200, name: 'MENSAL' }),
      UNIQUE,
      'customer_order_template_customer_name_uq',
    );
    // Another customer may reuse the name; another account creating for the same customer collides.
    await newTemplate(acc, { customerCode: 7201, name: 'Mensal' });
    const other = await newAccount();
    await expectPgError(
      newTemplate(other, { customerCode: 7200, name: 'mensal' }),
      UNIQUE,
      'customer_order_template_customer_name_uq',
    );
    // Soft-deleting frees the name; the deleted row stays.
    await softDelete(first);
    const again = await newTemplate(acc, { customerCode: 7200, name: 'Mensal' });
    // Several deleted rows may share a name.
    await softDelete(again);
    const third = await newTemplate(acc, { customerCode: 7200, name: 'Mensal' });
    expect(third).not.toBe(again);
    const deleted = await h.db
      .select({ id: customerOrderTemplate.id })
      .from(customerOrderTemplate)
      .where(sql`customer_code = 7200 and deleted_at is not null`);
    expect(deleted).toHaveLength(2);
  });

  it('creation is idempotent per account: (account, client_request_id) is unique, even after delete', async () => {
    const a = await newAccount();
    const b = await newAccount();
    const req = uuid();
    const id = await newTemplate(a, { clientRequestId: req });
    await expectPgError(
      newTemplate(a, { clientRequestId: req }),
      UNIQUE,
      'customer_order_template_account_request_uq',
    );
    // Another account may use the same client-generated id.
    await newTemplate(b, { clientRequestId: req });
    // A soft-deleted row still holds the key, so a replay can never re-create it.
    await softDelete(id);
    await expectPgError(
      newTemplate(a, { clientRequestId: req }),
      UNIQUE,
      'customer_order_template_account_request_uq',
    );
  });
});

describe('customer_order_template_item', () => {
  it('stores lines; (template_id, line_no) is the primary key', async () => {
    const t = await newTemplate(await newAccount());
    await h.db.insert(customerOrderTemplateItem).values([
      { templateId: t, lineNo: 1, productCode: 70001, quantity: '2' },
      { templateId: t, lineNo: 2, productCode: 70001, quantity: '0.0001' },
      { templateId: t, lineNo: 500, productCode: 70002, quantity: '9999999999.9999' },
    ]);
    await expectPgError(
      h.db.insert(customerOrderTemplateItem).values({ templateId: t, lineNo: 1, productCode: 70003, quantity: '1' }),
      UNIQUE,
      'customer_order_template_item_pk',
    );
    const rows = await h.db
      .select()
      .from(customerOrderTemplateItem)
      .where(eq(customerOrderTemplateItem.templateId, t));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.lineNo === 1)?.quantity).toBe('2.0000');
  });

  it('checks quantity > 0 and line_no between 1 and 500', async () => {
    const t = await newTemplate(await newAccount());
    for (const quantity of ['0', '-1', '-0.0001']) {
      await expectPgError(
        h.db.insert(customerOrderTemplateItem).values({ templateId: t, lineNo: 1, productCode: 1, quantity }),
        CHECK,
        'customer_order_template_item_quantity_chk',
      );
    }
    for (const lineNo of [0, -1, 501]) {
      await expectPgError(
        h.db.insert(customerOrderTemplateItem).values({ templateId: t, lineNo, productCode: 1, quantity: '1' }),
        CHECK,
        'customer_order_template_item_line_no_chk',
      );
    }
  });

  it('requires an existing template and cascades on hard delete; no FK to product', async () => {
    await expectPgError(
      h.db.insert(customerOrderTemplateItem).values({ templateId: uuid(), lineNo: 1, productCode: 1, quantity: '1' }),
      FK,
    );
    const t = await newTemplate(await newAccount());
    // Product 424242 is not in erp_product: accepted (revalidated when the template is used).
    await h.db.insert(customerOrderTemplateItem).values({ templateId: t, lineNo: 1, productCode: 424_242, quantity: '1' });
    await h.db.delete(customerOrderTemplate).where(eq(customerOrderTemplate.id, t));
    const left = await h.db
      .select()
      .from(customerOrderTemplateItem)
      .where(eq(customerOrderTemplateItem.templateId, t));
    expect(left).toHaveLength(0);
  });

  it('has no price, discount, notes or seller columns and no FK to sales_order', async () => {
    const cols = await h.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'public' and table_name like 'customer_order_template%'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    for (const banned of ['price', 'unit_price', 'discount', 'notes', 'seller_code', 'order_id']) {
      expect(names).not.toContain(banned);
    }
    const fks = await h.db.execute<{ ref: string }>(
      sql`select confrelid::regclass::text as ref from pg_constraint
          where contype = 'f' and conrelid::regclass::text like 'customer_order_template%'`,
    );
    expect(fks.rows.map((r) => r.ref).sort()).toEqual(['account', 'customer_order_template']);
  });
});
