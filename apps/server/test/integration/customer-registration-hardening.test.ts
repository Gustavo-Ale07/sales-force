import { randomUUID } from 'node:crypto';
import { auditLog, customerRegistration, customerRegistrationRefusal, erpCustomer, integrationOutbox } from '@salesforce/db';
import { CreateCustomerRequestSchema } from '@salesforce/contracts';
import { DEMO_ACCOUNT_EMAILS } from '@salesforce/sankhya';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENERIC_DUPLICATE_MESSAGE, MAX_CUSTOMER_CREATIONS_PER_HOUR, CustomerRegistrationService } from '../../src/customers/customer-registration.service.js';
import { CustomerRegistrationRepository } from '../../src/customers/customer-registration.repository.js';
import { AuditService } from '../../src/iam/audit.service.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import type { PolicyService } from '../../src/iam/policy.service.js';
import { CustomerPayloadRetention, CustomerRefusalRetention, CUSTOMER_PAYLOAD_RETENTION_DAYS, PURGED_PAYLOAD } from '../../src/integration/customer-payload-retention.js';
import { AppError } from '../../src/http/app-error.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { startPostgres, closeAllThenStop, type TestPostgres } from '../helpers/postgres.js';

/**
 * Security review of D-AR against a real PostgreSQL: the refused-duplicate limit (I-1), the portfolio-dependent message,
 * the request id owned by another account (M-1, the real 23505 shape) and the personal-data retention of the outbox (M-5).
 */

const DAY = 24 * 3600_000;
const NOW = new Date('2026-11-13T12:00:00Z');
const T = (name: string) => `${name} (hardening)`;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let seller1: string;
let seller2: string;
let manager: string;
let now = NOW;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  seller1 = ctx.accounts.ids[DEMO_ACCOUNT_EMAILS.seller1] as string;
  seller2 = ctx.accounts.ids[DEMO_ACCOUNT_EMAILS.seller2] as string;
  manager = ctx.accounts.ids[DEMO_ACCOUNT_EMAILS.manager] as string;
}, 180_000);
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const db = () => ctx.database.handle.db;

/** A valid CNPJ from a numeric base (check digits computed), so every test owns a document nobody else uses. */
function cnpj(base: number): string {
  const digits = String(base).padStart(12, '0').split('').map(Number);
  const check = (list: number[], weights: number[]) => {
    const sum = list.reduce((acc, d, i) => acc + d * (weights[i] as number), 0) % 11;
    return sum < 2 ? 0 : 11 - sum;
  };
  const d1 = check(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = check([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...digits, d1, d2].join('');
}

let documentSeed = 40_000_000;
const freshDocument = () => cnpj((documentSeed += 1));

function user(accountId: string, role: CurrentUser['role'], sellerCodes: number[]): CurrentUser {
  return { accountId, username: 'u', displayName: 'U', role, sellerCodes, sessionId: 's', sessionExpiresAt: new Date('2027-01-01'), channel: 'web' };
}
const sellerUser = (accountId: string, code: number) => user(accountId, 'seller', [code]);

function service(scope: unknown): CustomerRegistrationService {
  return new CustomerRegistrationService(
    { customerScope: () => Promise.resolve(scope) } as unknown as PolicyService,
    new CustomerRegistrationRepository(db()),
    new AuditService(db(), () => now),
    () => now,
    true,
    { timeoutMs: 0, pollMs: 1, sleep: () => Promise.resolve() },
  );
}

const request = (document: string, overrides: Record<string, unknown> = {}) =>
  CreateCustomerRequestSchema.parse({ clientRequestId: randomUUID(), document, name: T('Cliente Novo'), stateRegistration: 'ISENTO', ...overrides });

let mirrorCode = 900_000;
async function seedMirrorCustomer(document: string, values: Partial<typeof erpCustomer.$inferInsert> = {}): Promise<number> {
  mirrorCode += 1;
  await db().insert(erpCustomer).values({
    code: mirrorCode,
    name: T('Metalúrgica Alfa'),
    taxId: document,
    sellerCode: 103,
    active: true,
    isCustomer: true,
    blockedRaw: 'N',
    contentHash: 'h',
    syncedAt: NOW,
    ...values,
  });
  return mirrorCode;
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('I-1 refused duplicates count toward the hourly limit (real database)', () => {
  it('persists the refusal (it survives the refused transaction), counts it and then limits the account', async () => {
    const document = freshDocument();
    await seedMirrorCustomer(document);
    const svc = service({ kind: 'all' });
    for (let i = 0; i < MAX_CUSTOMER_CREATIONS_PER_HOUR; i += 1) {
      const error = await failure(svc.create(sellerUser(seller2, 107), request(document)));
      expect(error.code).toBe('conflict');
    }
    const refusals = await db().select().from(customerRegistrationRefusal).where(eq(customerRegistrationRefusal.accountId, seller2));
    expect(refusals).toHaveLength(MAX_CUSTOMER_CREATIONS_PER_HOUR);
    expect(await db().select().from(customerRegistration).where(eq(customerRegistration.createdByAccountId, seller2))).toHaveLength(0);
    // The 31st is limited whether or not the document is taken.
    expect((await failure(svc.create(sellerUser(seller2, 107), request(document)))).code).toBe('rate_limited');
    expect((await failure(svc.create(sellerUser(seller2, 107), request(freshDocument())))).code).toBe('rate_limited');
    // The window slides: an hour later the account may try again.
    now = new Date(NOW.getTime() + 3600_000 + 1000);
    try {
      expect((await failure(svc.create(sellerUser(seller2, 107), request(document)))).code).toBe('conflict');
    } finally {
      now = NOW;
    }
  });

  it('the refusal row and its audit entry hold no document, no name and no holder data', async () => {
    const [refusal] = await db().select().from(customerRegistrationRefusal).where(eq(customerRegistrationRefusal.accountId, seller2)).limit(1);
    expect(Object.keys(refusal ?? {}).sort()).toEqual(['accountId', 'createdAt', 'id', 'reason']);
    const audits = await db().select().from(auditLog).where(eq(auditLog.action, 'customer.registration_refused'));
    expect(audits.length).toBeGreaterThan(0);
    const text = JSON.stringify([refusal, audits]);
    expect(text).not.toMatch(/\d{14}/);
    expect(text).not.toContain('Metalúrgica');
    expect(text).not.toContain('Cliente Novo');
  });

  it('a duplicate against a registration still in flight is refused and counted too', async () => {
    const document = freshDocument();
    const svc = service({ kind: 'all' });
    const first = await svc.create(user(manager, 'manager', []), request(document, { sellerCode: 103 }));
    expect(first.httpStatus).toBe(202);
    const before = (await db().select().from(customerRegistrationRefusal).where(eq(customerRegistrationRefusal.accountId, manager))).length;
    const error = await failure(svc.create(user(manager, 'manager', []), request(document, { sellerCode: 103 })));
    expect(error.details).toEqual({ reason: 'document_already_registered' });
    expect((await db().select().from(customerRegistrationRefusal).where(eq(customerRegistrationRefusal.accountId, manager))).length).toBe(before + 1);
  });
});

describe('I-1 the message depends on the portfolio; status, code and details never do (real database)', () => {
  const scope103 = { kind: 'sellers', sellerCodes: [103] };

  it('in the portfolio: name and code; outside (other seller, inactive, blocked, deleted): the exact generic text', async () => {
    const svc = service(scope103);
    const own = freshDocument();
    const code = await seedMirrorCustomer(own, { sellerCode: 103 });
    const inside = await failure(svc.create(sellerUser(seller1, 103), request(own)));
    expect(inside.message).toContain(T('Metalúrgica Alfa'));
    expect(inside.message).toContain(String(code));

    const outsides: Array<Partial<typeof erpCustomer.$inferInsert>> = [
      { sellerCode: 107 },
      { sellerCode: 103, active: false },
      { sellerCode: 103, blockedRaw: 'S' },
      { sellerCode: 103, deletedAt: NOW },
      { sellerCode: null },
    ];
    for (const change of outsides) {
      const document = freshDocument();
      await seedMirrorCustomer(document, change);
      const outside = await failure(svc.create(sellerUser(seller1, 103), request(document)));
      expect(outside.message).toBe(GENERIC_DUPLICATE_MESSAGE);
      expect(outside.status).toBe(inside.status);
      expect(outside.code).toBe(inside.code);
      expect(outside.details).toEqual(inside.details);
      expect(JSON.stringify([outside.message, outside.details])).not.toContain('Metalúrgica');
    }
  });

  it('a manager or admin (scope all) is told who holds an active customer of any seller', async () => {
    const document = freshDocument();
    const code = await seedMirrorCustomer(document, { sellerCode: 107 });
    const error = await failure(service({ kind: 'all' }).create(user(manager, 'manager', []), request(document, { sellerCode: 103 })));
    expect(error.message).toContain(String(code));
    expect(error.message).toContain(T('Metalúrgica Alfa'));
  });
});

describe('I-1 a manager is told code and situation of an inactive, blocked or deleted holder; a seller is not (real database)', () => {
  it('manager/admin scope: code and situation only, no name; seller scope: the generic text', async () => {
    const cases: Array<[Partial<typeof erpCustomer.$inferInsert>, string]> = [
      [{ active: false }, 'inativo'],
      [{ blockedRaw: 'S' }, 'bloqueado'],
      [{ deletedAt: NOW }, 'excluído'],
    ];
    for (const [change, situation] of cases) {
      const document = freshDocument();
      const code = await seedMirrorCustomer(document, { sellerCode: 103, ...change });
      const asManager = await failure(service({ kind: 'all' }).create(user(manager, 'manager', []), request(document, { sellerCode: 103 })));
      expect(asManager.message).toBe(`Já existe com este documento, código ${code}, ${situation} no Sankhya. Procure o backoffice.`);
      expect(asManager.message).not.toContain('Metalúrgica');
      const asSeller = await failure(service({ kind: 'sellers', sellerCodes: [103] }).create(sellerUser(seller1, 103), request(document)));
      expect(asSeller.message).toBe(GENERIC_DUPLICATE_MESSAGE);
      expect(asSeller.details).toEqual(asManager.details);
    }
  });
});

describe('M-1 a request id used by another account (real unique index)', () => {
  it('answers idempotency_conflict (409) and reveals nothing of the other account', async () => {
    const clientRequestId = randomUUID();
    const svc = service({ kind: 'all' });
    const created = await svc.create(user(manager, 'manager', []), request(freshDocument(), { clientRequestId, sellerCode: 103 }));
    expect(created.httpStatus).toBe(202);
    const error = await failure(svc.create(sellerUser(seller1, 103), request(freshDocument(), { clientRequestId })));
    expect(error.code).toBe('idempotency_conflict');
    expect(error.status).toBe(409);
    expect(JSON.stringify([error.message, error.details])).not.toMatch(new RegExp(`${manager}|${clientRequestId}|customer_registration|force:`));
    // Nothing was recorded for the second account.
    expect(await db().select().from(customerRegistration).where(eq(customerRegistration.createdByAccountId, seller1))).toHaveLength(0);
  });
});

/** M-5: personal data of a finished customer command is cleared after 30 days; the row, key and state stay. */
describe('M-5 outbox personal-data retention (customer.upsert)', () => {
  const retention = () => new CustomerPayloadRetention({ database: db(), now: () => now });
  const personal = { document: '11222333000181', email: 'pessoa@exemplo.test', phone: '11999990000', notes: 'observação privada', name: 'Fulano' };

  async function outboxRow(status: string, updatedAt: Date, extra: Partial<typeof integrationOutbox.$inferInsert> = {}): Promise<string> {
    const id = uuidv7(updatedAt.getTime());
    await db().insert(integrationOutbox).values({
      id,
      aggregateType: 'customer_registration',
      aggregateId: uuidv7(),
      operation: 'customer.upsert',
      payload: personal,
      originId: `force:${id}`,
      status,
      nextAttemptAt: status === 'pending' || status === 'unknown' ? updatedAt : null,
      createdAt: updatedAt,
      updatedAt,
      ...extra,
    });
    return id;
  }
  const read = async (id: string) => (await db().select().from(integrationOutbox).where(eq(integrationOutbox.id, id)))[0];

  it('uses a 30-day window', () => {
    expect(CUSTOMER_PAYLOAD_RETENTION_DAYS).toBe(30);
  });

  it('clears a confirmed or rejected command strictly older than 30 days and keeps row, origin key, state and timestamps', async () => {
    const old = new Date(NOW.getTime() - 30 * DAY - 1);
    const confirmed = await outboxRow('confirmed', old, { erpReference: '777' });
    const rejected = await outboxRow('rejected', old, { lastErrorClass: 'validation' });
    expect(await retention().purge()).toBeGreaterThanOrEqual(2);
    for (const [id, status] of [[confirmed, 'confirmed'], [rejected, 'rejected']] as const) {
      const row = await read(id);
      expect(row?.payload).toEqual(PURGED_PAYLOAD);
      expect(JSON.stringify(row)).not.toMatch(/pessoa@|11999990000|11222333000181|observação/);
      expect(row).toMatchObject({ status, originId: `force:${id}`, operation: 'customer.upsert', aggregateType: 'customer_registration' });
      expect(row?.updatedAt.getTime()).toBe(old.getTime());
    }
    expect((await read(confirmed))?.erpReference).toBe('777');
  });

  it('exactly 30 days old is kept; one millisecond older is cleared', async () => {
    const exact = await outboxRow('confirmed', new Date(NOW.getTime() - 30 * DAY));
    const older = await outboxRow('confirmed', new Date(NOW.getTime() - 30 * DAY - 1));
    await retention().purge();
    expect((await read(exact))?.payload).toEqual(personal);
    expect((await read(older))?.payload).toEqual(PURGED_PAYLOAD);
  });

  it('never touches pending, processing, unknown (parked) or reprocessed rows, however old', async () => {
    const ancient = new Date(NOW.getTime() - 400 * DAY);
    const ids = [
      await outboxRow('pending', ancient),
      await outboxRow('processing', ancient),
      await outboxRow('unknown', ancient),
      await outboxRow('pending', ancient, { attemptCount: 3, lastErrorClass: 'unavailable' }),
    ];
    await retention().purge();
    for (const id of ids) expect((await read(id))?.payload).toEqual(personal);
  });

  it('never touches other aggregates, other operations or dry-run rows', async () => {
    const ancient = new Date(NOW.getTime() - 400 * DAY);
    // (Order rows cannot be faked here: a database gate admits them only for real eligible orders.)
    const otherOperation = await outboxRow('confirmed', ancient, { operation: 'customer.other' });
    const otherAggregate = await outboxRow('confirmed', ancient, { aggregateType: 'other_aggregate' });
    const dry = await outboxRow('dry_run', ancient);
    await retention().purge();
    expect((await read(otherOperation))?.payload).toEqual(personal);
    expect((await read(otherAggregate))?.payload).toEqual(personal);
    expect((await read(dry))?.payload).toEqual(personal);
  });

  it('is idempotent: a second run changes nothing and reports zero', async () => {
    const id = await outboxRow('rejected', new Date(NOW.getTime() - 90 * DAY));
    expect(await retention().purge()).toBeGreaterThanOrEqual(1);
    const after = await read(id);
    expect(await retention().purge()).toBe(0);
    expect(await read(id)).toEqual(after);
  });
});

/** Owner ruling 2026-11-13: error text and payload of finished commands go at 30 days; rejected registrations are deleted; refusals live 24 h. */
describe('retention of finished customer registrations (owner ruling 2026-11-13)', () => {
  const retention = () => new CustomerPayloadRetention({ database: db(), now: () => now });
  const refusalRetention = () => new CustomerRefusalRetention({ database: db(), now: () => now });
  const personal = { document: '11222333000181', email: 'pessoa@exemplo.test', notes: 'observação privada', name: 'Fulano' };
  const OLD = new Date(NOW.getTime() - 30 * DAY - 1);

  async function registration(status: 'pending' | 'confirmed' | 'rejected' | 'unknown', updatedAt: Date, outboxStatus?: string, lastErrorMessage: string | null = null) {
    const id = uuidv7(updatedAt.getTime());
    const clientRequestId = randomUUID();
    const taxId = freshDocument();
    await db().insert(customerRegistration).values({
      id,
      clientRequestId,
      requestHash: 'h',
      createdByAccountId: seller1,
      originKey: `force:${clientRequestId}`,
      status,
      taxId,
      name: T('Retenção'),
      sellerCode: 103,
      erpCustomerCode: status === 'confirmed' ? 4_000_000 + documentSeed : null,
      rejectionCode: status === 'rejected' ? 'partner_document_duplicate' : null,
      createdAt: updatedAt,
      updatedAt,
    });
    const outboxId = uuidv7(updatedAt.getTime());
    await db().insert(integrationOutbox).values({
      id: outboxId,
      aggregateType: 'customer_registration',
      aggregateId: id,
      operation: 'customer.upsert',
      payload: personal,
      originId: `force:${clientRequestId}`,
      status: outboxStatus ?? status,
      nextAttemptAt: status === 'pending' || status === 'unknown' ? updatedAt : null,
      lastErrorClass: lastErrorMessage === null ? null : 'validation',
      lastErrorMessage,
      createdAt: updatedAt,
      updatedAt,
    });
    return { id, outboxId, taxId };
  }
  const registrationRow = async (id: string) => (await db().select().from(customerRegistration).where(eq(customerRegistration.id, id)))[0];
  const outboxRow = async (id: string) => (await db().select().from(integrationOutbox).where(eq(integrationOutbox.id, id)))[0];

  it('clears the error message and the payload of terminal outbox rows after 30 days; keeps key, state and reference', async () => {
    const confirmed = await registration('confirmed', OLD, 'confirmed', 'transient: detalhe com Fulano 11222333000181');
    const rejected = await registration('rejected', OLD, 'rejected', 'partner_document_duplicate: CNPJ 11222333000181 de Fulano');
    await retention().purge();
    for (const { outboxId } of [confirmed, rejected]) {
      const row = await outboxRow(outboxId);
      expect(row?.lastErrorMessage).toBeNull();
      expect(row?.payload).toEqual(PURGED_PAYLOAD);
      expect(row?.originId).toMatch(/^force:/);
      expect(row?.lastErrorClass).toBe('validation'); // the class is a stable code, not free text: kept
    }
  });

  it('a terminal row whose payload was purged earlier but still has an error text is cleared too (idempotent afterwards)', async () => {
    const { outboxId } = await registration('rejected', OLD, 'rejected', 'texto antigo');
    await db().update(integrationOutbox).set({ payload: PURGED_PAYLOAD }).where(eq(integrationOutbox.id, outboxId));
    expect(await retention().purge()).toBeGreaterThanOrEqual(1);
    expect((await outboxRow(outboxId))?.lastErrorMessage).toBeNull();
    expect(await retention().purge()).toBe(0);
  });

  it('does not touch the error text of a row that can still be delivered, however old', async () => {
    const { outboxId } = await registration('unknown', new Date(NOW.getTime() - 400 * DAY), 'unknown', 'detalhe');
    await retention().purge();
    expect((await outboxRow(outboxId))?.lastErrorMessage).toBe('detalhe');
  });

  it('keeps tax id and name of a confirmed registration (the duplicate-check key), however old', async () => {
    const { id, taxId } = await registration('confirmed', new Date(NOW.getTime() - 400 * DAY), 'confirmed');
    await retention().purge();
    expect(await registrationRow(id)).toMatchObject({ taxId, name: T('Retenção'), status: 'confirmed' });
  });

  it('deletes a rejected registration strictly older than 30 days and keeps its outbox row (the origin key stays spent)', async () => {
    const old = await registration('rejected', OLD, 'rejected');
    const exact = await registration('rejected', new Date(NOW.getTime() - 30 * DAY), 'rejected');
    await retention().purge();
    expect(await registrationRow(old.id)).toBeUndefined();
    expect(await registrationRow(exact.id)).toBeDefined();
    expect(await outboxRow(old.outboxId)).toMatchObject({ status: 'rejected', aggregateId: old.id });
  });

  it('never deletes pending, unknown or confirmed registrations', async () => {
    const ancient = new Date(NOW.getTime() - 400 * DAY);
    const kept = [await registration('pending', ancient), await registration('unknown', ancient), await registration('confirmed', ancient)];
    await retention().purge();
    for (const { id } of kept) expect(await registrationRow(id)).toBeDefined();
  });

  it('never deletes a rejected registration whose outbox row can still be delivered (reprocessing)', async () => {
    const reprocessed = await registration('rejected', OLD, 'pending');
    await retention().purge();
    expect(await registrationRow(reprocessed.id)).toBeDefined();
  });

  it('the same request id after the purge is an idempotency conflict, never a 500 (the outbox keeps the origin key)', async () => {
    const clientRequestId = randomUUID();
    const svc = service({ kind: 'all' });
    const document = freshDocument();
    const first = await svc.create(sellerUser(seller1, 103), request(document, { clientRequestId }));
    expect(first.httpStatus).toBe(202);
    const created =(await db().select().from(customerRegistration).where(eq(customerRegistration.clientRequestId, clientRequestId)))[0]!;
    // Backdating is what the update guard forbids the application; the fixture ages the row as the table owner.
    await db().execute(sql`ALTER TABLE customer_registration DISABLE TRIGGER customer_registration_update_guard`);
    await db().update(customerRegistration).set({ status: 'rejected', rejectionCode: 'partner_document_duplicate', updatedAt: OLD }).where(eq(customerRegistration.id, created.id));
    await db().execute(sql`ALTER TABLE customer_registration ENABLE TRIGGER customer_registration_update_guard`);
    await db().update(integrationOutbox).set({ status: 'rejected', nextAttemptAt: null, updatedAt: OLD }).where(eq(integrationOutbox.aggregateId, created.id));
    await retention().purge();
    expect(await registrationRow(created.id)).toBeUndefined();
    const error = await failure(svc.create(sellerUser(seller1, 103), request(document, { clientRequestId })));
    expect(error.code).toBe('idempotency_conflict');
  });

  it('refusals: deletes those older than 24 hours, keeps the last 24 hours (the hourly limit reads one hour)', async () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms);
    const ids = { old: uuidv7(at(25 * 3600_000).getTime()), exact: uuidv7(at(24 * 3600_000).getTime()), recent: uuidv7(at(3600_000).getTime()) };
    await db().insert(customerRegistrationRefusal).values([
      { id: ids.old, accountId: seller1, reason: 'document_already_registered', createdAt: at(24 * 3600_000 + 1) },
      { id: ids.exact, accountId: seller1, reason: 'document_already_registered', createdAt: at(24 * 3600_000) },
      { id: ids.recent, accountId: seller1, reason: 'document_already_registered', createdAt: at(3600_000) },
    ]);
    expect(await refusalRetention().purge()).toBeGreaterThanOrEqual(1);
    const left = (await db().select({ id: customerRegistrationRefusal.id }).from(customerRegistrationRefusal)).map((r) => r.id);
    expect(left).not.toContain(ids.old);
    expect(left).toContain(ids.exact);
    expect(left).toContain(ids.recent);
    expect(await refusalRetention().purge()).toBe(0);
  });
});

describe('security review: the hourly limit is atomic per account (runs last, it exhausts the hour of the manager)', () => {
  it('parallel attempts of one account cannot overshoot the hourly limit (count and record are atomic per account)', async () => {
    const document = freshDocument();
    await seedMirrorCustomer(document);
    const svc = service({ kind: 'all' });
    const countFor = async () =>
      (await db().select().from(customerRegistrationRefusal).where(eq(customerRegistrationRefusal.accountId, manager))).length +
      (await db().select().from(customerRegistration).where(eq(customerRegistration.createdByAccountId, manager))).length;
    const before = await countFor();
    const outcomes = await Promise.all(
      Array.from({ length: MAX_CUSTOMER_CREATIONS_PER_HOUR + 10 }, () =>
        failure(svc.create(user(manager, 'manager', [101]), request(document))).then((e) => e.code),
      ),
    );
    expect((await countFor()) - before).toBeLessThanOrEqual(MAX_CUSTOMER_CREATIONS_PER_HOUR);
    expect(outcomes.filter((code) => code === 'rate_limited').length).toBeGreaterThanOrEqual(10);
  });
});
