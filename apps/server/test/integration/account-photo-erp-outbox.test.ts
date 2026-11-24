import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfilePhotoSchema } from '@salesforce/contracts';
import { integrationOutbox } from '@salesforce/db';
import { DEMO_ACCOUNT_EMAILS } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FilesystemObjectStore } from '../../src/media/object-store.js';
import { startCommercialApp, type CommercialApp, type Who } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/** Profile photo -> ERP (spike S1.8): the PUT queues the write in the same transaction, only while the flag is open. */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let open: CommercialApp;
let closed: CommercialApp;
let dir: string;

beforeAll(async () => {
  postgres = await startPostgres();
  dir = await mkdtemp(join(tmpdir(), 'sf-account-photo-erp-'));
  opened.push(() => rm(dir, { recursive: true, force: true }));
  open = await startCommercialApp(postgres, opened, {
    accountPhotoStore: new FilesystemObjectStore(dir),
    seedMirror: false,
    profilePhotoErpWriteEnabled: true,
  });
  closed = await startCommercialApp(postgres, opened, { accountPhotoStore: new FilesystemObjectStore(dir), seedMirror: false });
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const png = (color: number) =>
  sharp({ create: { width: 200, height: 200, channels: 3, background: { r: color, g: 40, b: 40 } } }).png().toBuffer();

async function put(app: CommercialApp, who: Who, data: Buffer) {
  app.clock.advance(10_000);
  return app.call(who, 'PUT', '/me/photo', { contentType: 'image/png', dataBase64: data.toString('base64') });
}

async function rowsOf(app: CommercialApp, who: Who) {
  const id = app.accounts.ids[DEMO_ACCOUNT_EMAILS[who]]!;
  const rows = await app.database.handle.db.select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, id));
  return { id, rows: rows.filter((r) => r.aggregateType === 'account_photo') };
}

describe('profile photo to the ERP: API side', () => {
  it('flag closed (default): nothing is queued', async () => {
    const r = await put(closed, 'seller1', await png(10));
    expect(r.status).toBe(200);
    expect((await rowsOf(closed, 'seller1')).rows).toHaveLength(0);
  });

  it('flag open: the PUT queues one pending job keyed by account + photo version, carrying a JPEG', async () => {
    const r = await put(open, 'seller1', await png(20));
    expect(r.status).toBe(200);
    const { version } = ProfilePhotoSchema.parse(r.body);
    const { id, rows } = await rowsOf(open, 'seller1');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.operation).toBe('profile_photo.write');
    expect(row.originId).toBe(`photo:${id}:${version}`);
    expect(row.status).toBe('pending');
    expect(row.nextAttemptAt).not.toBeNull();
    const payload = row.payload as { version: number; accountId: string; photoVersion: string; imageBase64: string };
    expect(payload.accountId).toBe(id);
    expect(payload.photoVersion).toBe(version);
    const bytes = Buffer.from(payload.imageBase64, 'base64');
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect((await sharp(bytes).metadata()).format).toBe('jpeg');
  });

  it('the same photo again (same version) does not queue a second job; a different photo does', async () => {
    const first = await rowsOf(open, 'seller1');
    await put(open, 'seller1', await png(20));
    expect((await rowsOf(open, 'seller1')).rows).toHaveLength(first.rows.length);
    await put(open, 'seller1', await png(200));
    expect((await rowsOf(open, 'seller1')).rows).toHaveLength(first.rows.length + 1);
  });

  it('removing the photo queues nothing (the ERP copy is not deleted)', async () => {
    const before = await rowsOf(open, 'seller1');
    open.clock.advance(10_000);
    const r = await open.call('seller1', 'DELETE', '/me/photo');
    expect(r.status).toBe(204);
    expect((await rowsOf(open, 'seller1')).rows).toHaveLength(before.rows.length);
  });

  it('a rejected upload queues nothing', async () => {
    const before = await rowsOf(open, 'seller2');
    const r = await put(open, 'seller2', Buffer.from('not an image'));
    expect(r.status).toBe(400);
    expect((await rowsOf(open, 'seller2')).rows).toHaveLength(before.rows.length);
  });
});
