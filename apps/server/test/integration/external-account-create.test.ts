import { account, accountSellerLink, auditLog, erpSeller, session } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountRepository } from '../../src/iam/account.repository.js';
import { AuditService } from '../../src/iam/audit.service.js';
import { AuthService } from '../../src/iam/auth.service.js';
import { DrizzleExternalAccountLinks, UNUSABLE_PASSWORD_HASH } from '../../src/iam/drizzle-external-account-links.js';
import { ExternalAccountError, ExternalAccountService } from '../../src/iam/external-account.service.js';
import { Argon2idPasswordHasher } from '../../src/iam/password-hasher.js';
import { SessionRepository } from '../../src/iam/session.repository.js';
import { ThrottleRepository } from '../../src/iam/throttle.repository.js';
import { createLogger } from '../../src/observability/logger.js';
import { storeConfiguration, seedDemoMirror } from '../helpers/commercial-fixture.js';
import { TestClock, createTestAccount, testAuthConfig } from '../helpers/auth.js';
import { FakeExternalIdentityVerifier } from '../helpers/external-identity.js';
import { captureLogs, createMigratedDatabase, startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const SANKHYA_PASSWORD = 'Sankhya-Only-Passphrase-77';
const EXTERNAL_ID = '4711';
const META = { ip: '203.0.113.9', userAgent: 'vitest', requestId: 'req-1' } as const;
const SIGNAL = new AbortController().signal;

async function setup(options: { config?: boolean } = {}) {
  const database = await createMigratedDatabase(postgres);
  opened.push(() => database.handle.close());
  const clock = new TestClock();
  await seedDemoMirror(database.handle);
  if (options.config !== false) await storeConfiguration(database.handle);
  const verifier = new FakeExternalIdentityVerifier();
  for (const login of ['SUP', 'sup']) {
    verifier.users.set(login, {
      password: SANKHYA_PASSWORD,
      identity: { externalUserId: EXTERNAL_ID, displayName: '', sellerCode: null, active: true },
    });
  }
  const audit = new AuditService(database.handle.db, clock.fn);
  const service = new ExternalAccountService(database.handle.db, verifier, audit, clock.fn).attributeTo('operator-test');
  return { database, db: database.handle.db, clock, verifier, service };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const create = (ctx: Ctx, over: Partial<Parameters<ExternalAccountService['createExternalAccount']>[0]> = {}) =>
  ctx.service.createExternalAccount(
    { username: 'SUP', displayName: 'Suporte', role: 'seller', sellerCode: 103, password: SANKHYA_PASSWORD, ...over },
    SIGNAL,
  );

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ExternalAccountError);
    return (error as ExternalAccountError).reason;
  }
  throw new Error('expected a refusal');
}

const accountRows = (ctx: Ctx) => ctx.db.select().from(account);

describe('ExternalAccountService.createExternalAccount', () => {
  it('creates an active seller account with the identity from the verifier, an unusable local password and the explicit link', async () => {
    const ctx = await setup();
    const id = await create(ctx);
    const [row] = await ctx.db.select().from(account).where(eq(account.id, id));
    expect(row).toMatchObject({ email: 'sup', role: 'seller', status: 'active', externalUserId: EXTERNAL_ID, passwordHash: UNUSABLE_PASSWORD_HASH });
    const links = await ctx.db.select().from(accountSellerLink).where(eq(accountSellerLink.accountId, id));
    expect(links.map((l) => l.sellerCode)).toEqual([103]);
    expect(ctx.verifier.calls).toEqual([{ login: 'SUP', passwordWasSecret: true }]);
  });

  it('audits creation and link without the password or the external identity', async () => {
    const ctx = await setup();
    const id = await create(ctx);
    const rows = await ctx.db.select().from(auditLog);
    expect(rows.map((r) => r.action).sort()).toEqual(['account.created', 'account.seller_linked']);
    const dump = JSON.stringify(rows);
    expect(dump).toContain(id);
    expect(dump).toContain('operator-test');
    for (const secret of [SANKHYA_PASSWORD, EXTERNAL_ID, 'Passphrase']) expect(dump).not.toContain(secret);
  });

  it('creates an admin without a seller link and refuses a seller code for it', async () => {
    const ctx = await setup();
    expect(await refusal(create(ctx, { role: 'admin' }))).toBe('seller_code_not_allowed');
    const id = await create(ctx, { role: 'admin', sellerCode: undefined });
    expect(await ctx.db.select().from(accountSellerLink).where(eq(accountSellerLink.accountId, id))).toHaveLength(0);
  });

  it('a seller without an explicit valid seller code is refused before the verifier is called', async () => {
    const ctx = await setup();
    expect(await refusal(create(ctx, { sellerCode: undefined }))).toBe('seller_code_required');
    expect(await refusal(create(ctx, { sellerCode: 0 }))).toBe('seller_code_required');
    expect(await refusal(create(ctx, { role: 'root' }))).toBe('invalid_role');
    expect(ctx.verifier.calls).toHaveLength(0);
    expect(await accountRows(ctx)).toHaveLength(0);
  });

  it('refuses an unknown, inactive or deleted seller and a seller already linked, creating nothing', async () => {
    const ctx = await setup();
    expect(await refusal(create(ctx, { sellerCode: 987654 }))).toBe('seller_unavailable');
    await ctx.db.update(erpSeller).set({ active: false }).where(eq(erpSeller.code, 103));
    expect(await refusal(create(ctx))).toBe('seller_unavailable');
    await ctx.db.update(erpSeller).set({ active: true, deletedAt: new Date() }).where(eq(erpSeller.code, 103));
    expect(await refusal(create(ctx))).toBe('seller_unavailable');
    await ctx.db.update(erpSeller).set({ deletedAt: null }).where(eq(erpSeller.code, 103));
    await create(ctx);
    ctx.verifier.users.set('other', { password: SANKHYA_PASSWORD, identity: { externalUserId: '4712', displayName: '', sellerCode: null, active: true } });
    expect(await refusal(create(ctx, { username: 'other' }))).toBe('seller_already_linked');
    expect(await accountRows(ctx)).toHaveLength(1);
  });

  it('refuses without a current configuration version and creates nothing', async () => {
    const ctx = await setup({ config: false });
    expect(await refusal(create(ctx))).toBe('no_configuration_version');
    expect(await accountRows(ctx)).toHaveLength(0);
  });

  it('refuses an existing login (the local administrator is never converted or touched)', async () => {
    const ctx = await setup();
    const admin = await createTestAccount(ctx.database.handle, { username: 'sup', role: 'admin' }, ctx.clock.fn);
    const before = (await ctx.db.select().from(account).where(eq(account.id, admin.id)))[0];
    expect(await refusal(create(ctx, { username: 'SUP', role: 'admin', sellerCode: undefined }))).toBe('username_taken');
    expect((await ctx.db.select().from(account).where(eq(account.id, admin.id)))[0]).toEqual(before);
    expect(await accountRows(ctx)).toHaveLength(1);
    expect(ctx.verifier.calls).toHaveLength(0);
  });

  it('refuses a Sankhya user that is already linked to another account', async () => {
    const ctx = await setup();
    await create(ctx);
    ctx.verifier.users.set('sup2', { password: SANKHYA_PASSWORD, identity: { externalUserId: EXTERNAL_ID, displayName: '', sellerCode: null, active: true } });
    expect(await refusal(create(ctx, { username: 'sup2', role: 'admin', sellerCode: undefined }))).toBe('external_identity_taken');
    expect(await accountRows(ctx)).toHaveLength(1);
  });

  it.each([
    ['wrong Sankhya password', () => undefined, 'invalid_credentials'],
    ['verifier error', (c: Ctx) => { c.verifier.forced = 'throw'; }, 'verifier_unavailable'],
    ['verifier unavailable', (c: Ctx) => { c.verifier.forced = { fail: 'unavailable' }; }, 'verifier_unavailable'],
    ['verifier rate limited', (c: Ctx) => { c.verifier.forced = { fail: 'rate_limited' }; }, 'verifier_rate_limited'],
    ['inactive directory user', (c: Ctx) => { c.verifier.forced = { ok: { externalUserId: '9', displayName: '', sellerCode: null, active: false } }; }, 'identity_inactive'],
  ] as const)('creates no account on %s', async (_label, prepare, reason) => {
    const ctx = await setup();
    prepare(ctx);
    expect(await refusal(create(ctx, { password: _label === 'wrong Sankhya password' ? 'not-the-password-123' : SANKHYA_PASSWORD }))).toBe(reason);
    expect(await accountRows(ctx)).toHaveLength(0);
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(0);
    expect(await ctx.db.select().from(auditLog)).toHaveLength(0);
  });

  it('refusal messages carry neither the password nor the external identity', async () => {
    const ctx = await setup();
    await create(ctx);
    ctx.verifier.users.set('dup', { password: SANKHYA_PASSWORD, identity: { externalUserId: EXTERNAL_ID, displayName: '', sellerCode: null, active: true } });
    try {
      await create(ctx, { username: 'dup', role: 'admin', sellerCode: undefined });
      throw new Error('expected a refusal');
    } catch (error) {
      const text = `${String(error)} ${JSON.stringify(error)}`;
      expect(text).not.toContain(SANKHYA_PASSWORD);
      expect(text).not.toContain(EXTERNAL_ID);
    }
  });

  it('the created account logs in through the external path with sellerCode:null and never with a local password', async () => {
    const ctx = await setup();
    const id = await create(ctx);
    const clock = new TestClock();
    const config = testAuthConfig({ externalLogin: { enabled: true, verifyTimeoutMs: 200, minFailureMs: 0 } });
    const capture = captureLogs();
    const auth = new AuthService(
      config,
      new Argon2idPasswordHasher(config.passwordHash),
      new AccountRepository(ctx.db),
      new SessionRepository(ctx.db),
      new ThrottleRepository(ctx.db),
      new AuditService(ctx.db, clock.fn),
      clock.fn,
      createLogger({ level: 'debug', service: 'api', destination: capture.stream }),
      ctx.verifier,
      new DrizzleExternalAccountLinks(ctx.db, new AuditService(ctx.db, clock.fn)),
    );
    const opened = await auth.loginExternal({ login: 'sup', password: SANKHYA_PASSWORD }, META);
    expect(opened.user).toMatchObject({ accountId: id, role: 'seller', sellerCodes: [103] });
    expect(await ctx.db.select().from(session)).toHaveLength(1);
    // The unusable local hash accepts no password at all.
    await expect(new Argon2idPasswordHasher(config.passwordHash).verify(UNUSABLE_PASSWORD_HASH, SANKHYA_PASSWORD)).resolves.toBe(false);
  });
});
