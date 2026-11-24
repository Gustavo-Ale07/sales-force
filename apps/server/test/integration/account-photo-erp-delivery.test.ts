import { randomUUID } from 'node:crypto';
import { auditLog, integrationOutbox } from '@salesforce/db';
import { FakeGateway, FakeUserPhotoBook, SankhyaGatewayError } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/iam/audit.service.js';
import { AccountPhotoRepository } from '../../src/iam/account-photo.repository.js';
import { DrizzleProfilePhotoDeliveryStore } from '../../src/integration/profile-photo-delivery.store.js';
import { ProfilePhotoDeliveryService } from '../../src/integration/profile-photo-delivery.service.js';
import { MAX_DELIVERY_ATTEMPTS } from '../../src/integration/order-delivery.policy.js';
import { createLogger } from '../../src/observability/logger.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/** Profile photo -> ERP, worker side (spike S1.8), against the fake gateway: no network, no Sandbox. */
const START = Date.parse('2026-11-24T12:00:00Z');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);

let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];
beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(
    databases.map((d) => () => d.handle.close()),
    postgres,
  );
});

const err = (kind: ConstructorParameters<typeof SankhyaGatewayError>[0], code = `t_${kind}`) =>
  new SankhyaGatewayError(kind, { code, message: `synthetic ${kind}` });

interface WorldOptions {
  externalUserId?: string | null;
  sellerCode?: number | null;
  directoryUsers?: number[];
}

async function world(options: WorldOptions = {}) {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const { pool, db } = database.handle;
  const clock = { ms: START };
  const now = () => new Date(clock.ms);
  const accountId = randomUUID();
  const configId = randomUUID();
  const book = new FakeUserPhotoBook();
  const gateway = new FakeGateway({ userPhotos: book });
  const audit = new AuditService(db, now);
  const service = new ProfilePhotoDeliveryService({
    store: new DrizzleProfilePhotoDeliveryStore(db, audit),
    gateway,
    logger: createLogger({ level: 'silent', service: 'test' }),
    now,
  });
  await pool.query(
    `INSERT INTO account (id, email, display_name, password_hash, role, external_user_id) VALUES ($1, 'p@example.test', 'P', 'x', 'seller', $2)`,
    [accountId, options.externalUserId ?? null],
  );
  if (options.sellerCode !== undefined && options.sellerCode !== null) {
    await pool.query(
      `INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at, is_current)
       VALUES ($1, 'v1', 'demo', '{}'::jsonb, 'h', now(), true)`,
      [configId],
    );
    await pool.query(`INSERT INTO account_seller_link (account_id, seller_code, config_version_id, source) VALUES ($1, $2, $3, 'manual')`, [accountId, options.sellerCode, configId]);
  }
  for (const code of options.directoryUsers ?? []) {
    await pool.query(`INSERT INTO erp_directory_user (code, seller_code, content_hash, synced_at) VALUES ($1, $2, 'h', now())`, [code, options.sellerCode ?? null]);
  }
  const repo = new AccountPhotoRepository(db);

  /** The current photo of the account is `hash` and its ERP write is queued (what PUT /me/photo does). */
  async function queue(hash: string, image: Buffer = JPEG) {
    await pool.query(
      `INSERT INTO account_photo (account_id, content_type, byte_length, size_px, content_hash, storage_key)
       VALUES ($1, 'image/webp', 10, 512, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET content_hash = excluded.content_hash, storage_key = excluded.storage_key`,
      [accountId, hash.padEnd(64, '0'), `k/${hash}`],
    );
    const version = hash.padEnd(64, '0').slice(0, 32);
    const id = randomUUID();
    await repo.enqueueErpWrite({ id, accountId, photoVersion: version, imageBase64: image.toString('base64'), at: now() });
    return { id, version };
  }
  const outbox = async (id: string) => (await db.select().from(integrationOutbox).where(eq(integrationOutbox.id, id)))[0]!;
  const audits = async (action: string) => (await db.select().from(auditLog)).filter((r) => r.action === action);
  return { database, accountId, book, service, queue, outbox, audits, advance: (ms: number) => void (clock.ms += ms), gateway };
}

describe('profile photo delivery to the ERP (fake gateway)', () => {
  it('writes the JPEG to the user of the account (external user id), confirms and drops the image from the payload', async () => {
    const w = await world({ externalUserId: '77' });
    const { id } = await w.queue('a1');
    const summary = await w.service.runDue();
    expect(summary.processed).toBe(1);
    expect(w.book.writes).toEqual([{ userCode: 77, idempotencyKey: expect.stringMatching(/^photo:/) as string }]);
    const row = await w.outbox(id);
    expect(row.status).toBe('confirmed');
    expect(row.erpReference).toBe('77');
    expect(row.nextAttemptAt).toBeNull();
    expect(JSON.stringify(row.payload)).not.toContain('imageBase64');
    expect(await w.audits('account.photo_erp_written')).toHaveLength(1);
  });

  it('falls back to the seller link: exactly one ERP user of the seller', async () => {
    const w = await world({ sellerCode: 9, directoryUsers: [41] });
    const { id } = await w.queue('b2');
    await w.service.runDue();
    expect(w.book.writes.map((x) => x.userCode)).toEqual([41]);
    expect((await w.outbox(id)).status).toBe('confirmed');
  });

  it('no linked ERP user: permanent rejection, nothing sent', async () => {
    const w = await world();
    const { id } = await w.queue('c3');
    await w.service.runDue();
    expect(w.book.writes).toHaveLength(0);
    const row = await w.outbox(id);
    expect(row.status).toBe('rejected');
    expect(row.lastErrorMessage).toContain('photo_no_erp_user');
    expect(await w.audits('account.photo_erp_rejected')).toHaveLength(1);
  });

  it('two ERP users for the seller: ambiguous, rejected, nothing sent (never guess)', async () => {
    const w = await world({ sellerCode: 9, directoryUsers: [41, 42] });
    const { id } = await w.queue('d4');
    await w.service.runDue();
    expect(w.book.writes).toHaveLength(0);
    expect((await w.outbox(id)).lastErrorMessage).toContain('photo_ambiguous_erp_user');
    expect((await w.outbox(id)).status).toBe('rejected');
  });

  it('a version that is no longer the current photo is never sent (a late retry cannot overwrite a newer photo)', async () => {
    const w = await world({ externalUserId: '77' });
    const old = await w.queue('e5');
    await w.queue('f6');
    const first = await w.outbox(old.id);
    expect(first.status).toBe('pending');
    await w.service.runDue();
    expect(w.book.writes).toHaveLength(1);
    const photo = [...w.book.photos.values()];
    expect(photo).toHaveLength(1);
    expect((await w.outbox(old.id)).status).toBe('rejected');
    expect((await w.outbox(old.id)).lastErrorMessage).toContain('photo_superseded');
  });

  it('repeating a sweep does not resend a confirmed version (idempotent per account + version)', async () => {
    const w = await world({ externalUserId: '77' });
    await w.queue('a1');
    await w.queue('a1');
    await w.service.runDue();
    await w.service.runDue();
    expect(w.book.writes).toHaveLength(1);
    expect(w.book.photos.size).toBe(1);
  });

  it('a transient failure retries with backoff, then confirms; the same key is sent each time', async () => {
    const w = await world({ externalUserId: '77' });
    const { id } = await w.queue('a1');
    w.book.script({ kind: 'error', error: err('unavailable') });
    await w.service.runDue();
    let row = await w.outbox(id);
    expect(row.status).toBe('unknown');
    expect(row.attemptCount).toBe(1);
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(START);
    await w.service.runDue();
    expect(w.book.writes).toHaveLength(1);
    w.advance(120_000);
    await w.service.runDue();
    row = await w.outbox(id);
    expect(row.status).toBe('confirmed');
    expect(new Set(w.book.writes.map((x) => x.idempotencyKey)).size).toBe(1);
    expect(w.book.photos.size).toBe(1);
  });

  it('a permanent refusal from the ERP is final and is never retried', async () => {
    const w = await world({ externalUserId: '77' });
    const { id } = await w.queue('a1');
    w.book.script({ kind: 'error', error: err('permanent', 'erp_refused_user_photo') });
    await w.service.runDue();
    const row = await w.outbox(id);
    expect(row.status).toBe('rejected');
    expect(row.nextAttemptAt).toBeNull();
    w.advance(3_600_000);
    await w.service.runDue();
    expect(w.book.writes).toHaveLength(1);
  });

  it('an authentication failure waits long and does not consume an attempt', async () => {
    const w = await world({ externalUserId: '77' });
    const { id } = await w.queue('a1');
    w.book.script({ kind: 'error', error: err('auth') });
    await w.service.runDue();
    const row = await w.outbox(id);
    expect(row.status).toBe('pending');
    expect(row.attemptCount).toBe(0);
    expect(row.nextAttemptAt!.getTime() - START).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it('gives up after the maximum attempts of a persistent transient failure', async () => {
    const w = await world({ externalUserId: '77' });
    const { id } = await w.queue('a1');
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) w.book.script({ kind: 'error', error: err('temporary') });
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
      await w.service.runDue();
      w.advance(30 * 60_000);
    }
    const row = await w.outbox(id);
    expect(row.status).toBe('rejected');
    expect(row.attemptCount).toBe(MAX_DELIVERY_ATTEMPTS);
  });

  it('a row left processing by a dead worker is recovered and sent again', async () => {
    const w = await world({ externalUserId: '77' });
    const { id } = await w.queue('a1');
    await w.database.handle.pool.query(`UPDATE integration_outbox SET status = 'processing', updated_at = $2 WHERE id = $1`, [id, new Date(START - 3_600_000)]);
    await w.service.runDue();
    expect((await w.outbox(id)).status).toBe('confirmed');
  });
});
