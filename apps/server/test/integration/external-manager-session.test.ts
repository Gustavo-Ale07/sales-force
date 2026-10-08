import { account, accountSellerLink, auditLog, erpSeller, installationConfigurationVersion, session } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { AccountRepository } from '../../src/iam/account.repository.js';
import { AuditService } from '../../src/iam/audit.service.js';
import { withExternalSellerLogin, LOCAL_MODE_ROLES } from '../../src/iam/auth-config.js';
import { AuthService } from '../../src/iam/auth.service.js';
import { DrizzleExternalAccountLinks, UNUSABLE_PASSWORD_HASH } from '../../src/iam/drizzle-external-account-links.js';
import { Argon2idPasswordHasher } from '../../src/iam/password-hasher.js';
import { SessionRepository } from '../../src/iam/session.repository.js';
import { generateSessionToken, hashSessionToken } from '../../src/iam/session-crypto.js';
import { ThrottleRepository } from '../../src/iam/throttle.repository.js';
import { createLogger } from '../../src/observability/logger.js';
import { TestClock, createTestAccount, testAuthConfig, TEST_PASSWORD } from '../helpers/auth.js';
import { storeConfiguration } from '../helpers/commercial-fixture.js';
import { FakeExternalIdentityVerifier } from '../helpers/external-identity.js';
import { captureLogs, closeAllThenStop, createMigratedDatabase, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * The production configuration of an installation with the Sankhya login on: `local` mode (admin/technical by password)
 * plus `withExternalSellerLogin`. A manager may hold a session only as an account linked to a directory user.
 */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterEach(async () => {
  for (const close of opened.splice(0).reverse()) await close();
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const META = { ip: '203.0.113.9', userAgent: 'vitest', requestId: 'req-1' } as const;
const SANKHYA_PASSWORD = 'Sankhya-Synthetic-Pass-77';

async function setup(linkMode?: 'VERIFIED_AUTO_PROVISION') {
  const database = await createMigratedDatabase(postgres);
  opened.push(() => database.handle.close());
  const db = database.handle.db;
  const clock = new TestClock();
  const capture = captureLogs();
  const config = withExternalSellerLogin(testAuthConfig({ authMode: 'local', allowedRoles: LOCAL_MODE_ROLES }), {
    enabled: true,
    verifyTimeoutMs: 200,
    minFailureMs: 0,
    ...(linkMode === undefined ? {} : { linkMode }),
  });
  const verifier = new FakeExternalIdentityVerifier();
  const audit = new AuditService(db, clock.fn);
  const service = new AuthService(
    config,
    new Argon2idPasswordHasher(config.passwordHash),
    new AccountRepository(db),
    new SessionRepository(db),
    new ThrottleRepository(db),
    audit,
    clock.fn,
    createLogger({ level: 'debug', service: 'api', destination: capture.stream }),
    verifier,
    new DrizzleExternalAccountLinks(db, audit),
  );
  await storeConfiguration(database.handle);
  return { database, db, clock, service, verifier };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** An account linked to a directory user (as `create-external` leaves it) and that user in the fake directory. */
async function externalAccount(ctx: Ctx, login: string, role: 'manager' | 'seller' | 'admin', externalUserId: string) {
  const created = await createTestAccount(ctx.database.handle, { username: login, role }, ctx.clock.fn);
  await ctx.db.update(account).set({ externalUserId, passwordHash: UNUSABLE_PASSWORD_HASH }).where(eq(account.id, created.id));
  for (const key of [login, login.toUpperCase()]) ctx.verifier.users.set(key, {
    password: SANKHYA_PASSWORD,
    identity: { externalUserId, displayName: '', sellerCode: null, active: true },
  });
  return created;
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`unexpected non-AppError: ${String((error as Error).name)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

describe('external manager session (external-only role gate)', () => {
  it('an external manager explicitly linked, with sellerCode:null, logs in', async () => {
    const ctx = await setup();
    const manager = await externalAccount(ctx, 'sup', 'manager', '4711');
    const opened = await ctx.service.login({ username: 'SUP', password: SANKHYA_PASSWORD }, META);
    expect(opened.user).toMatchObject({ accountId: manager.id, role: 'manager', sellerCodes: [] });
    expect(await ctx.db.select().from(session)).toHaveLength(1);
  });

  it('with auto-provision on, an existing external manager (Sankhya CODUSU 0, no CODVEND) logs in: no seller sync, no seller link', async () => {
    const ctx = await setup('VERIFIED_AUTO_PROVISION');
    const manager = await externalAccount(ctx, 'sup', 'manager', '0');
    const opened = await ctx.service.login({ username: 'SUP', password: SANKHYA_PASSWORD }, META);
    expect(opened.user).toMatchObject({ accountId: manager.id, role: 'manager', sellerCodes: [] });
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(0);
    expect(await ctx.db.select().from(account).where(eq(account.id, manager.id))).toMatchObject([{ role: 'manager' }]);
    const failures = (await ctx.db.select().from(auditLog)).filter((row) => row.action === 'auth.login.failure');
    expect(failures).toHaveLength(0);
    // Still no seller authority on the session refresh.
    expect((await ctx.service.resolveSession(opened.token, 'web'))?.user).toMatchObject({ role: 'manager', sellerCodes: [] });
  });

  it('the external manager session stays valid on refresh (resolveSession and peekSession)', async () => {
    const ctx = await setup();
    await externalAccount(ctx, 'sup', 'manager', '4711');
    const { token } = await ctx.service.login({ username: 'SUP', password: SANKHYA_PASSWORD }, META);
    const resolved = await ctx.service.resolveSession(token, 'web');
    expect(resolved?.user.role).toBe('manager');
    expect(await ctx.service.peekSession(token)).toEqual({ role: 'manager' });
  });

  it('a local manager with a local password keeps getting invalid_credentials and no session', async () => {
    const ctx = await setup();
    const local = await createTestAccount(ctx.database.handle, { username: 'gerente', role: 'manager' }, ctx.clock.fn);
    const refused = await failure(ctx.service.login({ username: 'gerente', password: TEST_PASSWORD }, META));
    expect(refused.code).toBe('invalid_credentials');
    expect(await ctx.db.select().from(session)).toHaveLength(0);
    const rows = await ctx.db.select().from(auditLog);
    expect(rows.find((row) => row.actorAccountId === local.id)?.detail).toMatchObject({ reason: 'mode_role_not_permitted' });
  });

  it('a local manager is not admitted even when it carries an old session (no external link)', async () => {
    const ctx = await setup();
    const local = await createTestAccount(ctx.database.handle, { username: 'gerente', role: 'manager' }, ctx.clock.fn);
    const repo = new SessionRepository(ctx.db);
    const token = generateSessionToken();
    const now = ctx.clock.fn();
    await repo.create({ id: crypto.randomUUID(), accountId: local.id, tokenHash: hashSessionToken(token), createdAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    expect(await ctx.service.resolveSession(token, 'web')).toBeNull();
    expect(await ctx.service.peekSession(token)).toBeNull();
  });

  it('an external seller with a valid link still logs in; one without a link is still refused', async () => {
    const ctx = await setup();
    await ctx.db.insert(erpSeller).values({ code: 103, name: 'Vendedor 103', active: true, contentHash: 'h103', syncedAt: new Date('2026-09-01T00:00:00Z') });
    const linked = await externalAccount(ctx, 'ana', 'seller', '501');
    const [version] = await ctx.db.select({ id: installationConfigurationVersion.id }).from(installationConfigurationVersion);
    await ctx.db.insert(accountSellerLink).values({ accountId: linked.id, sellerCode: 103, configVersionId: version!.id });
    await externalAccount(ctx, 'bia', 'seller', '502');

    expect((await ctx.service.login({ username: 'ana', password: SANKHYA_PASSWORD }, META)).user).toMatchObject({ role: 'seller', sellerCodes: [103] });
    const refused = await failure(ctx.service.login({ username: 'bia', password: SANKHYA_PASSWORD }, META));
    expect(refused.code).toBe('access_not_configured');
    expect(refused.status).toBe(403);
  });

  it('the local admin still logs in by password', async () => {
    const ctx = await setup();
    await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    const result = await ctx.service.login({ username: 'admin', password: TEST_PASSWORD }, META);
    expect(result.user.role).toBe('admin');
  });

  it('a wrong Sankhya password for the external manager is invalid_credentials and opens no session', async () => {
    const ctx = await setup();
    await externalAccount(ctx, 'sup', 'manager', '4711');
    const refused = await failure(ctx.service.login({ username: 'SUP', password: 'not-the-sankhya-password-1' }, META));
    expect(refused.code).toBe('invalid_credentials');
    expect(await ctx.db.select().from(session)).toHaveLength(0);
  });
});
