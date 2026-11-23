import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfilePhotoSchema, SessionResponseSchema } from '@salesforce/contracts';
import { accountPhoto, auditLog } from '@salesforce/db';
import { eq, inArray } from 'drizzle-orm';
import { DEMO_ACCOUNT_EMAILS } from '@salesforce/sankhya';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountPhotoRepository } from '../../src/iam/account-photo.repository.js';
import { FilesystemObjectStore } from '../../src/media/object-store.js';
import { TEST_ORIGIN, TEST_PASSWORD, createTestAccount } from '../helpers/auth.js';
import { loginCookie } from '../helpers/auth-app.js';
import { startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/** Own profile photo: validation, server-side rendition, own-only access, audit and compatibility. */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let app: CommercialApp;
let bare: CommercialApp;
let dir: string;

beforeAll(async () => {
  postgres = await startPostgres();
  dir = await mkdtemp(join(tmpdir(), 'sf-account-photo-'));
  opened.push(() => rm(dir, { recursive: true, force: true }));
  app = await startCommercialApp(postgres, opened, { accountPhotoStore: new FilesystemObjectStore(dir), seedMirror: false });
  bare = await startCommercialApp(postgres, opened, { seedMirror: false });
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const jpeg = (width: number, height: number, withExif = false) => {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg();
  return (withExif ? image.withExif({ IFD0: { Copyright: 'secret-copyright', Software: 'secret-software' } }) : image).toBuffer();
};
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 200, alpha: 1 } } }).png().toBuffer();
const webp = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 0, g: 200, b: 0 } } }).webp().toBuffer();

const put = (who: Who, contentType: string, data: Buffer | string, crop?: unknown) =>
  app.call(who, 'PUT', '/me/photo', {
    contentType,
    dataBase64: typeof data === 'string' ? data : data.toString('base64'),
    ...(crop === undefined ? {} : { crop }),
  });
const rawGet = (who: Who) =>
  app.app.inject({ method: 'GET', url: '/api/v1/me/photo', headers: { origin: TEST_ORIGIN, cookie: app.cookies[who] } });
const idOf = (who: Who) => app.accounts.ids[DEMO_ACCOUNT_EMAILS[who]]!;
const issues = (r: { body: Json }) => r.body.details.issues.map((i: Json) => i.code);

describe('upload validation', () => {
  it('accepts JPEG, PNG and WebP and answers the version', async () => {
    for (const [type, data] of [
      ['image/jpeg', await jpeg(800, 600)],
      ['image/png', await png(300, 300)],
      ['image/webp', await webp(300, 400)],
    ] as const) {
      app.clock.advance(10_000);
      const r = await put('seller1', type, data);
      expect(r.status, type).toBe(200);
      const parsed = ProfilePhotoSchema.parse(r.body);
      expect(parsed.contentType).toBe('image/webp');
    }
  });

  it('refuses a file whose magic bytes are not an allowed image (text, GIF, SVG)', async () => {
    app.clock.advance(10_000);
    const text = await put('seller2', 'image/png', Buffer.from('hello, I am not an image'));
    expect(text.status).toBe(400);
    expect(issues(text)).toEqual(['photo_type_not_allowed']);
    app.clock.advance(10_000);
    const gif = await put('seller2', 'image/png', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary'));
    expect(issues(gif)).toEqual(['photo_type_not_allowed']);
    app.clock.advance(10_000);
    const svg = await put('seller2', 'image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(issues(svg)).toEqual(['photo_type_not_allowed']);
  });

  it('refuses a declared type that contradicts the content (magic bytes win over the header)', async () => {
    app.clock.advance(10_000);
    const r = await put('seller2', 'image/jpeg', await png(200, 200));
    expect(r.status).toBe(400);
    expect(issues(r)).toEqual(['photo_content_mismatch']);
    app.clock.advance(10_000);
    expect((await put('seller2', 'image/webp', await jpeg(200, 200))).status).toBe(400);
  });

  it('refuses a truncated or corrupt image, an invalid base64 and a too small image', async () => {
    app.clock.advance(10_000);
    const whole = await png(200, 200);
    const corrupt = await put('seller2', 'image/png', whole.subarray(0, 40));
    expect(issues(corrupt)).toEqual(['photo_unreadable']);
    app.clock.advance(10_000);
    const notBase64 = await put('seller2', 'image/png', '!!!not base64!!!');
    expect(issues(notBase64)).toEqual(['photo_unreadable']);
    app.clock.advance(10_000);
    const tiny = await put('seller2', 'image/png', await png(32, 32));
    expect(issues(tiny)).toEqual(['photo_too_small']);
  });

  it('refuses an upload over 5 MiB and an unknown extra field', async () => {
    app.clock.advance(10_000);
    const big = randomBytes(5 * 1024 * 1024 + 1024);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const r = await put('seller2', 'image/jpeg', big);
    expect([400, 413]).toContain(r.status);
    app.clock.advance(10_000);
    const extra = await app.call('seller2', 'PUT', '/me/photo', { contentType: 'image/png', dataBase64: (await png(100, 100)).toString('base64'), accountId: '019a0000-0000-7000-8000-000000000000' });
    expect(extra.status).toBe(400);
  });

  it('refuses a decompression bomb (too many pixels) without storing anything', async () => {
    app.clock.advance(10_000);
    // 6000 x 6000 = 36 MP of a flat colour: a small PNG file that decodes above the 32 MP ceiling.
    const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    const r = await put('seller2', 'image/png', bomb);
    expect(r.status).toBe(400);
    expect(issues(r)).toEqual(['photo_too_large']);
  });
});

describe('rendition', () => {
  it('center-crops to a square, downsizes to 512 px and re-encodes as WebP', async () => {
    app.clock.advance(10_000);
    const r = await put('manager', 'image/jpeg', await jpeg(1600, 900));
    expect(r.status).toBe(200);
    expect(r.body.sizePx).toBe(512);
    const got = await rawGet('manager');
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/webp');
    const meta = await sharp(got.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
  });

  it('never enlarges a small image', async () => {
    app.clock.advance(10_000);
    const r = await put('manager', 'image/png', await png(200, 100));
    expect(r.body.sizePx).toBe(100);
  });

  it('applies an optional crop rectangle (after orientation) and rejects one outside the image', async () => {
    app.clock.advance(10_000);
    // Left half red, right half blue: cropping the right half must yield blue.
    const left = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    const right = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer();
    const two = await sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 400, top: 0 }])
      .png()
      .toBuffer();
    const ok = await put('manager', 'image/png', two, { x: 400, y: 0, width: 400, height: 400 });
    expect(ok.status).toBe(200);
    const bytes = (await rawGet('manager')).rawPayload;
    const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[2]).toBeGreaterThan(200); // blue channel of the first pixel
    expect(data[0]).toBeLessThan(60);
    app.clock.advance(10_000);
    const outside = await put('manager', 'image/png', two, { x: 600, y: 0, width: 400, height: 400 });
    expect(outside.status).toBe(400);
    expect(issues(outside)).toEqual(['photo_crop_invalid']);
  });

  it('strips EXIF and other metadata, and applies the orientation', async () => {
    app.clock.advance(10_000);
    const tagged = await sharp(await jpeg(300, 200, true)).withExif({ IFD0: { Copyright: 'secret-copyright', Software: 'secret-software' } }).toBuffer();
    expect(Buffer.from(tagged).includes(Buffer.from('secret-copyright'))).toBe(true);
    const r = await put('seller1', 'image/jpeg', tagged);
    expect(r.status).toBe(200);
    const bytes = (await rawGet('seller1')).rawPayload;
    const meta = await sharp(bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(bytes.includes(Buffer.from('secret-copyright'))).toBe(false);
    expect(bytes.includes(Buffer.from('secret-software'))).toBe(false);
  });
});

describe('own-only access, caching and removal', () => {
  it('has no photo at first (404) and each account sees only its own', async () => {
    expect((await app.call('admin', 'GET', '/me/photo')).status).toBe(404);
    app.clock.advance(10_000);
    expect((await put('seller1', 'image/jpeg', await jpeg(300, 300))).status).toBe(200);
    const mine = await rawGet('seller1');
    expect(mine.statusCode).toBe(200);
    // Another account never receives it and cannot name it: the route has no account parameter.
    expect((await app.call('admin', 'GET', '/me/photo')).status).toBe(404);
    const other = await app.call('admin', 'GET', `/me/photo?accountId=${idOf('seller1')}`);
    expect(other.status).toBe(404);
    const rows = await app.database.handle.db.select().from(accountPhoto);
    expect(rows.find((r) => r.accountId === idOf('admin'))).toBeUndefined();
  });

  it('is private, versioned and revalidates by ETag (304)', async () => {
    const first = await rawGet('seller1');
    const etag = first.headers['etag'] as string;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    expect(first.headers['vary']).toMatch(/Cookie/i);
    expect(first.headers['content-type']).toBe('image/webp');
    expect(first.headers['x-content-type-options']).toBe('nosniff');
    const again = await app.app.inject({
      method: 'GET',
      url: '/api/v1/me/photo',
      headers: { origin: TEST_ORIGIN, cookie: app.cookies.seller1, 'if-none-match': etag },
    });
    expect(again.statusCode).toBe(304);
    expect(again.headers['cache-control']).toBe('private, no-cache');
    expect(again.headers['vary']).toMatch(/Cookie/i);
    // The version published in the session is the same value.
    const session = await app.call('seller1', 'GET', '/auth/session');
    expect(`"${session.body.account.photoVersion}"`).toBe(etag);
  });

  it('refuses an anonymous caller (no public URL)', async () => {
    const r = await app.app.inject({ method: 'GET', url: '/api/v1/me/photo', headers: { origin: TEST_ORIGIN } });
    expect(r.statusCode).toBe(401);
  });

  it('replacing changes the version and the old object is deleted; the table keeps one row per account', async () => {
    const before = (await rawGet('seller1')).headers['etag'];
    app.clock.advance(10_000);
    expect((await put('seller1', 'image/png', await png(250, 250))).status).toBe(200);
    const after = (await rawGet('seller1')).headers['etag'];
    expect(after).not.toBe(before);
    const rows = await app.database.handle.db.select().from(accountPhoto).where(eq(accountPhoto.accountId, idOf('seller1')));
    expect(rows).toHaveLength(1);
    expect(await readdir(join(dir, 'account-photos', idOf('seller1')))).toEqual([rows[0]!.contentHash]);
  });

  it('answers 429 when changed again within 5 seconds', async () => {
    app.clock.advance(10_000);
    expect((await put('seller1', 'image/png', await png(120, 120))).status).toBe(200);
    app.clock.advance(1_000);
    const r = await put('seller1', 'image/png', await png(130, 130));
    expect(r.status).toBe(429);
  });

  it('removes the photo (idempotent), deletes the object and the session no longer carries a version', async () => {
    const id = idOf('seller1');
    app.clock.advance(10_000);
    expect((await app.call('seller1', 'DELETE', '/me/photo')).status).toBe(204);
    expect((await app.call('seller1', 'GET', '/me/photo')).status).toBe(404);
    app.clock.advance(10_000);
    expect((await app.call('seller1', 'DELETE', '/me/photo')).status).toBe(204);
    expect(await app.database.handle.db.select().from(accountPhoto).where(eq(accountPhoto.accountId, id))).toHaveLength(0);
    expect(await readdir(join(dir, 'account-photos', id))).toEqual([]);
    const session = await app.call('seller1', 'GET', '/auth/session');
    expect(session.body.account.photoVersion ?? null).toBeNull();
  });
});

describe('audit', () => {
  it('records change and removal with ids and sizes only, never image content', async () => {
    const events = await app.database.handle.db
      .select()
      .from(auditLog)
      .where(inArray(auditLog.action, ['account.photo_changed', 'account.photo_removed']));
    expect(events.some((e) => e.action === 'account.photo_changed' && e.actorAccountId === idOf('seller1'))).toBe(true);
    // Idempotent second delete wrote nothing: exactly one removal for seller1.
    expect(events.filter((e) => e.action === 'account.photo_removed' && e.actorAccountId === idOf('seller1'))).toHaveLength(1);
    for (const event of events) {
      const detail = JSON.stringify(event.detail);
      expect(detail.length).toBeLessThan(300);
      expect(Object.keys(event.detail as object).every((k) => ['version', 'sizePx', 'byteLength', 'replaced'].includes(k))).toBe(true);
    }
  });
});

describe('change limits (PUT and DELETE share one slot per account, failed attempts count)', () => {
  it('lets only one of several parallel uploads of the same account proceed', async () => {
    app.clock.advance(10_000);
    const data = await png(200, 200);
    const results = await Promise.all([1, 2, 3, 4].map(() => put('admin', 'image/png', data)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429, 429, 429]);
  });

  it('counts a failed upload as an attempt', async () => {
    app.clock.advance(10_000);
    expect((await put('seller2', 'image/png', Buffer.from('not an image'))).status).toBe(400);
    expect((await put('seller2', 'image/png', await png(200, 200))).status).toBe(429);
    app.clock.advance(10_000);
    expect((await put('seller2', 'image/png', await png(200, 200))).status).toBe(200);
  });

  it('limits a DELETE followed by an upload, and an upload followed by a DELETE, within 5 seconds', async () => {
    app.clock.advance(10_000);
    expect((await app.call('manager', 'DELETE', '/me/photo')).status).toBe(204);
    app.clock.advance(1_000);
    expect((await put('manager', 'image/png', await png(200, 200))).status).toBe(429);
    app.clock.advance(10_000);
    expect((await put('manager', 'image/png', await png(200, 200))).status).toBe(200);
    app.clock.advance(1_000);
    expect((await app.call('manager', 'DELETE', '/me/photo')).status).toBe(429);
  });

  it('serializes concurrent claims in the database (the guard that holds across API instances)', async () => {
    const repository = new AccountPhotoRepository(app.database.handle.db);
    const id = idOf('admin');
    const at = new Date(app.clock.fn().getTime() + 3_600_000);
    const claims = await Promise.all([1, 2, 3, 4, 5].map(() => repository.claimSlot(id, at, 5_000)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});

describe('compatibility and profiles', () => {
  it('the session of an account without a photo still parses and an old client that ignores photoVersion loses nothing', async () => {
    const session = await app.call('admin', 'GET', '/auth/session');
    const parsed = SessionResponseSchema.parse(session.body);
    expect(parsed.authenticated).toBe(true);
    const { photoVersion: _ignored, ...legacy } = session.body.account;
    expect(Object.keys(legacy).sort()).toEqual(['displayName', 'id', 'role', 'sellerCodes', 'username']);
  });

  it('technical and operations profiles may have their own photo too', async () => {
    for (const role of ['technical', 'operations'] as const) {
      await createTestAccount(app.database.handle, { username: `${role}-photo@example.test`, role }, app.clock.fn);
      const cookie = await loginCookie(app, `${role}-photo@example.test`, TEST_PASSWORD);
      const r = await app.app.inject({
        method: 'PUT',
        url: '/api/v1/me/photo',
        headers: { origin: TEST_ORIGIN, cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ contentType: 'image/png', dataBase64: (await png(150, 150)).toString('base64') }),
      });
      expect(r.statusCode, role).toBe(200);
      const got = await app.app.inject({ method: 'GET', url: '/api/v1/me/photo', headers: { origin: TEST_ORIGIN, cookie } });
      expect(got.statusCode, role).toBe(200);
    }
  });

  it('answers 503 on every photo route and publishes no version when photo storage is not configured', async () => {
    expect((await bare.call('seller1', 'GET', '/me/photo')).status).toBe(503);
    const upload = await bare.call('seller1', 'PUT', '/me/photo', { contentType: 'image/png', dataBase64: (await png(100, 100)).toString('base64') });
    expect(upload.status).toBe(503);
    expect((await bare.call('seller1', 'DELETE', '/me/photo')).status).toBe(503);
    const session = await bare.call('seller1', 'GET', '/auth/session');
    expect(session.body.account.photoVersion ?? null).toBeNull();
  });
});
