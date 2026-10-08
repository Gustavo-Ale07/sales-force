import { account, accountSellerLink, auditLog, erpDirectoryUser, erpSeller, installationConfigurationVersion, session, syncState } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { AccountRepository } from '../../src/iam/account.repository.js';
import { AuditService } from '../../src/iam/audit.service.js';
import { createOperatorAccountService } from '../../src/cli/operator.js';
import { ExternalAccountPasswordError } from '../../src/iam/account.service.js';
import { withExternalSellerLogin, LOCAL_MODE_ROLES, type ExternalLinkMode } from '../../src/iam/auth-config.js';
import { failureFloor } from '../../src/iam/failure-floor.js';
import { AuthService } from '../../src/iam/auth.service.js';
import { DrizzleExternalAccountLinks } from '../../src/iam/drizzle-external-account-links.js';
import { CredentialSecret } from '../../src/iam/external-identity.js';
import { Argon2idPasswordHasher } from '../../src/iam/password-hasher.js';
import { SankhyaIdentityVerifier } from '../../src/iam/sankhya-identity-verifier.js';
import { SessionRepository } from '../../src/iam/session.repository.js';
import { hashSessionToken } from '../../src/iam/session-crypto.js';
import { ThrottleRepository } from '../../src/iam/throttle.repository.js';
import { createLogger } from '../../src/observability/logger.js';
import { storeConfiguration } from '../helpers/commercial-fixture.js';
import { TestClock, createTestAccount, testAuthConfig, TEST_HASH_PARAMS, TEST_PASSWORD, WRONG_PASSWORD } from '../helpers/auth.js';
import { FakeExternalIdentityVerifier } from '../helpers/external-identity.js';
import { captureLogs, closeAllThenStop, createMigratedDatabase, startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
beforeAll(async () => {
  postgres = await startPostgres();
});
// Every test builds its own database through setup(); its pool is closed as soon as the test ends (pass or fail),
// so the file never holds more than one pool of the container's max_connections at a time.
afterEach(async () => {
  await closeAllThenStop(opened.splice(0), undefined);
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const META = { ip: '203.0.113.9', userAgent: 'vitest', requestId: 'req-1' } as const;
const SANKHYA_PASSWORD = 'Sankhya-Synthetic-Pass-77';
const SYNCED = new Date('2026-09-18T00:00:00.000Z');

/** Provisioning tests opt in explicitly: the default link mode is PRE_LINKED (no login ever creates an account). */
const AUTO = { linkMode: 'VERIFIED_AUTO_PROVISION' } as const;

async function setup(options: { external?: boolean; linkMode?: ExternalLinkMode; minFailureMs?: number } = {}) {
  const database = await createMigratedDatabase(postgres);
  opened.push(() => database.handle.close());
  const db = database.handle.db;
  const clock = new TestClock();
  const capture = captureLogs();
  const logger = createLogger({ level: 'debug', service: 'api', destination: capture.stream });
  const base = testAuthConfig({ authMode: 'local', allowedRoles: LOCAL_MODE_ROLES });
  const external = options.external !== false;
  const config = external ? withExternalSellerLogin(base, {
        enabled: true,
        verifyTimeoutMs: 200,
        minFailureMs: options.minFailureMs ?? 0,
        ...(options.linkMode === undefined ? {} : { linkMode: options.linkMode }),
      }) : base;
  const verifier = new FakeExternalIdentityVerifier();
  const audit = new AuditService(db, clock.fn);
  const links = new DrizzleExternalAccountLinks(db, audit);
  const service = new AuthService(
    config,
    new Argon2idPasswordHasher(config.passwordHash),
    new AccountRepository(db),
    new SessionRepository(db),
    new ThrottleRepository(db),
    audit,
    clock.fn,
    logger,
    external ? verifier : undefined,
    external ? links : undefined,
  );
  await storeConfiguration(database.handle);
  return { database, db, clock, capture, service, verifier, links };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

async function addSeller(ctx: Ctx, code: number, name: string, opts: { active?: boolean; deleted?: boolean } = {}) {
  await ctx.db.insert(erpSeller).values({
    code,
    name,
    active: opts.active ?? true,
    contentHash: `h${code}`,
    syncedAt: SYNCED,
    ...(opts.deleted === true ? { deletedAt: SYNCED } : {}),
  });
}

/** A directory user: what the verifier answers AND what the ERP relation mirror says (CODUSU -> CODVEND). */
async function directoryUser(ctx: Ctx, login: string, codusu: number, codvend: number | null, active = true) {
  ctx.verifier.users.set(login, {
    password: SANKHYA_PASSWORD,
    identity: { externalUserId: String(codusu), displayName: '', sellerCode: codvend, active },
  });
  await mirrorDirectoryUser(ctx, codusu, codvend);
}

async function mirrorDirectoryUser(ctx: Ctx, codusu: number, codvend: number | null, opts: { deleted?: boolean } = {}) {
  const values = { sellerCode: codvend, contentHash: `d${codusu}-${codvend ?? 'x'}`, syncedAt: SYNCED, deletedAt: opts.deleted === true ? SYNCED : null };
  await ctx.db.insert(erpDirectoryUser).values({ code: codusu, ...values }).onConflictDoUpdate({ target: erpDirectoryUser.code, set: values });
  await markDirectoryFresh(ctx);
}

/** The relation mirror last succeeded at the test clock's "now" (a stale one is simulated by advancing the clock or passing `at`). */
async function markDirectoryFresh(ctx: Ctx, at: Date = ctx.clock.fn()) {
  await ctx.db
    .insert(syncState)
    .values({ entity: 'directoryUsers', status: 'idle', lastSuccessAt: at })
    .onConflictDoUpdate({ target: syncState.entity, set: { lastSuccessAt: at } });
}

async function directoryAudit(ctx: Ctx, action: string): Promise<string[]> {
  return (await ctx.db.select().from(auditLog).where(eq(auditLog.action, action))).map((r) => (r.detail as { reason: string }).reason);
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected a failure');
}

describe('AuthService.login (user name + password, hybrid)', () => {
  it('keeps the local admin working (valid password) with no directory call', async () => {
    const ctx = await setup(AUTO);
    const admin = await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    const result = await ctx.service.login({ username: 'admin', password: TEST_PASSWORD }, META);
    expect(result.user).toMatchObject({ accountId: admin.id, role: 'admin', channel: 'web' });
    expect(ctx.verifier.calls).toHaveLength(0);
  });

  it('still accepts an e-mail-shaped local admin as a plain user name', async () => {
    const ctx = await setup(AUTO);
    await createTestAccount(ctx.database.handle, { username: 'Admin@Example.Test', role: 'admin' }, ctx.clock.fn);
    const result = await ctx.service.login({ username: 'admin@example.test', password: TEST_PASSWORD }, META);
    expect(result.user.role).toBe('admin');
  });

  it('refuses a wrong local admin password without asking the directory', async () => {
    const ctx = await setup(AUTO);
    await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    const err = await failure(ctx.service.login({ username: 'admin', password: 'wrong-wrong-wrong' }, META));
    expect(err.code).toBe('invalid_credentials');
    expect(ctx.verifier.calls).toHaveLength(0);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
  });

  it('signs in a valid Sankhya user, provisioning a seller account linked by stable ids', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);

    const result = await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);

    expect(result.user).toMatchObject({ role: 'seller', sellerCodes: [103], channel: 'web', displayName: 'Vendedor Sintetico' });
    const [row] = await ctx.db.select().from(account).where(eq(account.externalUserId, '4501'));
    expect(row).toMatchObject({ role: 'seller', status: 'active', email: 'sankhya:4501' });
    expect(row?.passwordHash).not.toContain(SANKHYA_PASSWORD);
    const [link] = await ctx.db.select().from(accountSellerLink);
    expect(link).toMatchObject({ accountId: row?.id, sellerCode: 103 });
    const created = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'account.created'));
    expect(created).toHaveLength(1);
    expect(ctx.verifier.calls).toHaveLength(1);
  });

  it('opens a correct Force session (opaque token, only its hash stored) and reuses the account on the next login', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    const first = await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    const second = await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.user.accountId).toBe(first.user.accountId);
    expect(await ctx.db.select().from(account)).toHaveLength(1);
    const rows = await ctx.db.select().from(session);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.tokenHash)).toContain(hashSessionToken(first.token));
    expect(rows.every((r) => r.tokenHash !== first.token)).toBe(true);
    const resolved = await ctx.service.resolveSession(first.token);
    expect(resolved?.user).toMatchObject({ role: 'seller', sellerCodes: [103] });
  });

  it('refuses a wrong Sankhya password and a nonexistent Sankhya user with the same uniform error', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    const wrong = await failure(ctx.service.login({ username: 'plac123', password: 'not-the-password' }, META));
    const missing = await failure(ctx.service.login({ username: 'ghost', password: SANKHYA_PASSWORD }, META));
    expect(wrong.code).toBe('invalid_credentials');
    expect(missing.code).toBe('invalid_credentials');
    expect(wrong.status).toBe(missing.status);
    expect(wrong.message).toBe('Usuário ou senha inválidos.');
    expect(await ctx.db.select().from(account)).toHaveLength(0);
  });

  it('answers a Sankhya outage and a verifier crash with service_unavailable, never a session', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    ctx.verifier.forced = { fail: 'unavailable' };
    expect((await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META))).code).toBe('service_unavailable');
    ctx.verifier.forced = 'throw';
    expect((await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META))).code).toBe('service_unavailable');
    ctx.verifier.forced = 'hang';
    expect((await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META))).code).toBe('service_unavailable');
    expect(await ctx.db.select().from(session)).toHaveLength(0);
    expect(await ctx.db.select().from(account)).toHaveLength(0);
  });

  it('refuses a verified user with no seller (403 access_not_configured), creating no account (reason only in the audit)', async () => {
    const ctx = await setup(AUTO);
    await directoryUser(ctx, 'semvend', 4502, null);
    const err = await failure(ctx.service.login({ username: 'semvend', password: SANKHYA_PASSWORD }, META));
    expect(err.code).toBe('access_not_configured');
    expect(err.message).toBe('Usuário autenticado, mas o acesso ao Force ainda não está configurado.');
    expect(await ctx.db.select().from(account)).toHaveLength(0);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
    const [row] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.login.failure'));
    expect(row?.detail).toMatchObject({ reason: 'external_directory_refused' });
    expect(await directoryAudit(ctx, 'auth.directory.link_refused')).toEqual(['no_seller']);
  });

  it('refuses an inactive, deleted or unmirrored seller', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 110, 'Inativo', { active: false });
    await addSeller(ctx, 111, 'Apagado', { deleted: true });
    await directoryUser(ctx, 'inativo', 4510, 110);
    await directoryUser(ctx, 'apagado', 4511, 111);
    await directoryUser(ctx, 'fantasma', 4512, 999);
    for (const login of ['inativo', 'apagado', 'fantasma']) {
      expect((await failure(ctx.service.login({ username: login, password: SANKHYA_PASSWORD }, META))).code).toBe('access_not_configured');
    }
    expect(await ctx.db.select().from(account)).toHaveLength(0);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
  });

  it('refuses an existing account whose seller became inactive after provisioning: link removed, sessions revoked', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    const first = await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    await ctx.db.update(erpSeller).set({ active: false }).where(eq(erpSeller.code, 103));
    const err = await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META));
    expect(err.code).toBe('access_not_configured');
    expect(await directoryAudit(ctx, 'auth.directory.link_revoked')).toEqual(['seller_inactive']);
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(0);
    const [live] = await ctx.db.select().from(session).where(eq(session.accountId, first.user.accountId));
    expect(live?.revokedAt).not.toBeNull();
    // Reactivated in the ERP: the same account follows it again, no second account.
    await ctx.db.update(erpSeller).set({ active: true }).where(eq(erpSeller.code, 103));
    const again = await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    expect(again.user).toMatchObject({ accountId: first.user.accountId, sellerCodes: [103] });
    expect(await ctx.db.select().from(account)).toHaveLength(1);
  });

  it('refuses a user not authorized for the Force: linked account that is disabled', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    await ctx.db.update(account).set({ status: 'disabled' }).where(eq(account.externalUserId, '4501'));
    const err = await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META));
    expect(err.code).toBe('access_not_configured');
  });

  it('refuses a directory-inactive user', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103, false);
    expect((await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META))).code).toBe('access_not_configured');
    expect(await ctx.db.select().from(account)).toHaveLength(0);
  });

  it('isolates sellers: a user whose seller is already linked to another account is refused, and nothing is stolen', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Um');
    await addSeller(ctx, 107, 'Vendedor Dois');
    const owner = await preLink(ctx, { username: 'manual', externalUserId: '4501', sellerCode: 103 });
    await directoryUser(ctx, 'dois', 4502, 103); // the ERP says user 4502 is seller 103, but a Force account already holds it
    await directoryUser(ctx, 'tres', 4503, 107);
    expect((await failure(ctx.service.login({ username: 'dois', password: SANKHYA_PASSWORD }, META))).code).toBe('access_not_configured');
    expect(await directoryAudit(ctx, 'auth.directory.link_refused')).toEqual(['seller_claimed']);
    const three = await ctx.service.login({ username: 'tres', password: SANKHYA_PASSWORD }, META);
    expect(three.user.sellerCodes).toEqual([107]);
    const links = await ctx.db.select().from(accountSellerLink);
    expect(links.find((l) => l.accountId === owner.id)).toMatchObject({ sellerCode: 103, source: 'manual' });
    expect(await ctx.db.select().from(account)).toHaveLength(2);
  });

  it('refuses both users when the ERP ties two users to one seller (ambiguous), creating nothing', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Um');
    await directoryUser(ctx, 'um', 4501, 103);
    await directoryUser(ctx, 'dois', 4502, 103);
    for (const login of ['um', 'dois']) {
      expect((await failure(ctx.service.login({ username: login, password: SANKHYA_PASSWORD }, META))).code).toBe('access_not_configured');
    }
    expect(await directoryAudit(ctx, 'auth.directory.link_refused')).toEqual(['seller_ambiguous', 'seller_ambiguous']);
    expect(await ctx.db.select().from(account)).toHaveLength(0);
  });

  it('never provisions a privileged role: the new account is a seller and an admin handle is not claimable', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    expect((await ctx.db.select().from(account)).every((row) => row.role === 'seller')).toBe(true);
    // The provisioned handle is not a usable local login (no password hash verifies).
    const err = await failure(ctx.service.login({ username: 'sankhya:4501', password: 'whatever-whatever' }, META));
    expect(err.code).toBe('invalid_credentials');
  });

  it('never returns, stores or logs the password', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    const result = await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    await failure(ctx.service.login({ username: 'plac123', password: 'wrong-secret-xyz' }, META));
    const everything = JSON.stringify({
      result,
      accounts: await ctx.db.select().from(account),
      audit: await ctx.db.select().from(auditLog),
      sessions: await ctx.db.select().from(session),
      logs: ctx.capture.lines(),
      secret: JSON.stringify(ctx.verifier.lastPasswordObject),
    });
    expect(everything).not.toContain(SANKHYA_PASSWORD);
    expect(everything).not.toContain('wrong-secret-xyz');
    expect(ctx.verifier.calls.every((call) => call.passwordWasSecret)).toBe(true);
  });

  it('with the directory login disabled, an unknown user gets the uniform failure and nothing is called', async () => {
    const ctx = await setup({ external: false });
    const err = await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META));
    expect(err.code).toBe('invalid_credentials');
    expect(ctx.verifier.calls).toHaveLength(0);
  });
});

describe('AuthService.login: restrictions of the directory path', () => {
  it('does not fall through to the directory for a disabled local account', async () => {
    const ctx = await setup(AUTO);
    const admin = await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    await ctx.db.update(account).set({ status: 'disabled' }).where(eq(account.id, admin.id));
    await directoryUser(ctx, 'admin', 4001, null);
    const err = await failure(ctx.service.login({ username: 'admin', password: SANKHYA_PASSWORD }, META));
    expect(err.code).toBe('invalid_credentials');
    expect(ctx.verifier.calls).toHaveLength(0);
  });

  it('refuses an identity without a stable external id and creates nothing', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    ctx.verifier.forced = { ok: { externalUserId: '', displayName: '', sellerCode: 103, active: true } };
    expect((await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META))).code).toBe('access_not_configured');
    expect(await ctx.db.select().from(account)).toHaveLength(0);
  });

  it('follows the ERP when it moves the user to another valid, unclaimed seller (old sessions revoked)', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Um');
    await addSeller(ctx, 107, 'Vendedor Dois');
    await directoryUser(ctx, 'um', 4501, 103);
    const first = await ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META);
    await directoryUser(ctx, 'um', 4501, 107); // the ERP now ties the same stable id to another seller
    const second = await ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META);
    expect(second.user).toMatchObject({ accountId: first.user.accountId, sellerCodes: [107] });
    const [old] = await ctx.db.select().from(session).where(eq(session.id, first.user.sessionId));
    expect(old?.revokedAt).not.toBeNull();
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(1);
  });

  it('refuses a stale or never-synchronized relation mirror without creating anything (fail closed)', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Um');
    await directoryUser(ctx, 'um', 4501, 103);
    await markDirectoryFresh(ctx, new Date(ctx.clock.fn().getTime() - 3 * 60 * 60 * 1000)); // older than the 2 h default
    expect((await failure(ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META))).code).toBe('access_not_configured');
    expect(await directoryAudit(ctx, 'auth.directory.link_refused')).toEqual(['directory_stale']);
    expect(await ctx.db.select().from(account)).toHaveLength(0);
    await ctx.db.delete(syncState);
    expect((await failure(ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META))).code).toBe('access_not_configured');
    expect(await ctx.db.select().from(account)).toHaveLength(0);
  });

  it('never promotes or reuses a pre-linked admin account from directory data', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    const admin = await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    await ctx.db.update(account).set({ externalUserId: '9000' }).where(eq(account.id, admin.id));
    await directoryUser(ctx, 'someone', 9000, 103);
    expect((await failure(ctx.service.login({ username: 'someone', password: SANKHYA_PASSWORD }, META))).code).toBe('access_not_configured');
    const [row] = await ctx.db.select().from(account).where(eq(account.id, admin.id));
    expect(row?.role).toBe('admin');
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(0);
  });

  it('is idempotent when the same directory user signs in concurrently for the first time', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    const results = await Promise.allSettled([
      ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META),
      ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META),
      ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await ctx.db.select().from(account)).toHaveLength(1);
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(1);
  });

  it('keeps one account and one link when many first logins race, for different sellers too', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Um');
    await addSeller(ctx, 107, 'Vendedor Dois');
    await directoryUser(ctx, 'um', 4501, 103);
    await directoryUser(ctx, 'dois', 4502, 107);
    const results = await Promise.allSettled([
      ...Array.from({ length: 4 }, () => ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META)),
      ...Array.from({ length: 4 }, () => ctx.service.login({ username: 'dois', password: SANKHYA_PASSWORD }, META)),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await ctx.db.select().from(account)).toHaveLength(2);
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(2);
  });

  it('forwards the user name to the directory as typed (trimmed only, case kept)', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'SAMUEL', 4501, 103);
    const ok = await ctx.service.login({ username: '  SAMUEL  ', password: SANKHYA_PASSWORD }, META);
    expect(ok.user.sellerCodes).toEqual([103]);
    expect(ctx.verifier.calls.at(-1)?.login).toBe('SAMUEL');
  });
});

/** An account an administrator (or a test) linked to a directory user beforehand. */
async function preLink(ctx: Ctx, opts: { username: string; externalUserId: string; role?: 'seller' | 'admin'; sellerCode?: number }) {
  const created = await createTestAccount(ctx.database.handle, { username: opts.username, role: opts.role ?? 'seller' }, ctx.clock.fn);
  await ctx.db.update(account).set({ externalUserId: opts.externalUserId }).where(eq(account.id, created.id));
  if (opts.sellerCode !== undefined) {
    const [version] = await ctx.db.select({ id: installationConfigurationVersion.id }).from(installationConfigurationVersion);
    await ctx.db.insert(accountSellerLink).values({ accountId: created.id, sellerCode: opts.sellerCode, configVersionId: version?.id ?? '' });
  }
  return created;
}

describe('revocation of an automatic link on an established session', () => {
  const PAST_TOUCH = 61_000; // sessionTouchIntervalMs is 60 s

  async function signedIn() {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Um');
    await directoryUser(ctx, 'um', 4501, 103);
    const login = await ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META);
    return { ctx, login };
  }

  it('keeps a session working while the ERP relation still holds', async () => {
    const { ctx, login } = await signedIn();
    ctx.clock.advance(PAST_TOUCH);
    expect((await ctx.service.resolveSession(login.token))?.user).toMatchObject({ role: 'seller', sellerCodes: [103] });
  });

  it('ends the session when the seller is deactivated in the ERP, and removes the link', async () => {
    const { ctx, login } = await signedIn();
    await ctx.db.update(erpSeller).set({ active: false }).where(eq(erpSeller.code, 103));
    ctx.clock.advance(PAST_TOUCH);
    expect(await ctx.service.resolveSession(login.token)).toBeNull();
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(0);
    expect(await directoryAudit(ctx, 'auth.directory.link_revoked')).toEqual(['seller_inactive']);
  });

  it('ends the session when the ERP drops the user -> seller relation', async () => {
    const { ctx, login } = await signedIn();
    await mirrorDirectoryUser(ctx, 4501, null);
    ctx.clock.advance(PAST_TOUCH);
    expect(await ctx.service.resolveSession(login.token)).toBeNull();
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(0);
  });

  it('ends the session when the ERP moves the user to another seller (the user signs in again under the new scope)', async () => {
    const { ctx, login } = await signedIn();
    await addSeller(ctx, 107, 'Vendedor Dois');
    await mirrorDirectoryUser(ctx, 4501, 107);
    ctx.clock.advance(PAST_TOUCH);
    expect(await ctx.service.resolveSession(login.token)).toBeNull();
    await directoryUser(ctx, 'um', 4501, 107);
    const again = await ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META);
    expect(again.user.sellerCodes).toEqual([107]);
  });

  it('fails closed on a stale mirror without changing the link, and recovers when the mirror is fresh again', async () => {
    const { ctx, login } = await signedIn();
    ctx.clock.advance(3 * 60 * 60 * 1000);
    expect(await ctx.service.resolveSession(login.token)).toBeNull();
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(1);
    expect(await directoryAudit(ctx, 'auth.directory.link_revoked')).toEqual([]);
    await markDirectoryFresh(ctx);
    const again = await ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META);
    expect(again.user.sellerCodes).toEqual([103]);
  });

  it('does not re-grant a link an operator removed (a re-check never inserts)', async () => {
    const { ctx, login } = await signedIn();
    await ctx.db.delete(accountSellerLink);
    ctx.clock.advance(PAST_TOUCH);
    await ctx.service.resolveSession(login.token);
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(0);
  });

  it('an administrator override (upsertSellerLink) turns an automatic link into a manual one the ERP no longer moves', async () => {
    const { ctx, login } = await signedIn();
    await addSeller(ctx, 107, 'Vendedor Dois');
    const [version] = await ctx.db.select({ id: accountSellerLink.configVersionId }).from(accountSellerLink);
    await new AccountRepository(ctx.db).upsertSellerLink({ accountId: login.user.accountId, sellerCode: 107, configVersionId: version!.id });
    ctx.clock.advance(PAST_TOUCH);
    expect(await ctx.service.resolveSession(login.token)).not.toBeNull();
    expect(await ctx.db.select().from(accountSellerLink)).toMatchObject([{ sellerCode: 107, source: 'manual' }]);
  });

  it('never re-checks (or revokes) a manual link', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Um');
    await directoryUser(ctx, 'um', 4501, 103);
    await preLink(ctx, { username: 'manual', externalUserId: '4501', sellerCode: 103 });
    const login = await ctx.service.login({ username: 'um', password: SANKHYA_PASSWORD }, META);
    await mirrorDirectoryUser(ctx, 4501, null);
    ctx.clock.advance(PAST_TOUCH);
    expect(await ctx.service.resolveSession(login.token)).not.toBeNull();
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(1);
  });
});

describe('link mode: PRE_LINKED is the default and never creates accounts', () => {
  it.each([[undefined], ['PRE_LINKED' as const]])('a directory user without a linked account is refused and nothing is created (mode %s)', async (linkMode) => {
    const ctx = await setup(linkMode === undefined ? {} : { linkMode });
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    const err = await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META));
    expect(err.code).toBe('access_not_configured');
    expect(err.message).toBe('Usuário autenticado, mas o acesso ao Force ainda não está configurado.');
    expect(await ctx.db.select().from(account)).toHaveLength(0);
    expect(await ctx.db.select().from(accountSellerLink)).toHaveLength(0);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
    const [row] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.login.failure'));
    expect(row?.detail).toMatchObject({ reason: 'external_unmapped' });
  });

  it('never calls syncFromDirectory in PRE_LINKED', async () => {
    const ctx = await setup();
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    let called = 0;
    const original = ctx.links.syncFromDirectory.bind(ctx.links);
    ctx.links.syncFromDirectory = (input) => {
      called += 1;
      return original(input);
    };
    await failure(ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META));
    expect(called).toBe(0);
  });

  it('signs in a pre-linked seller account (external_user_id + seller link set beforehand)', async () => {
    const ctx = await setup();
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    const linked = await preLink(ctx, { username: 'plac123', externalUserId: '4501', sellerCode: 103 });
    await directoryUser(ctx, 'plac123', 4501, 103);
    const result = await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    expect(result.user).toMatchObject({ accountId: linked.id, role: 'seller', sellerCodes: [103] });
    expect(await ctx.db.select().from(account)).toHaveLength(1);
  });

  it('still refuses a pre-linked account when the directory password is wrong (never a local verdict)', async () => {
    const ctx = await setup();
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await preLink(ctx, { username: 'plac123', externalUserId: '4501', sellerCode: 103 });
    await directoryUser(ctx, 'plac123', 4501, 103);
    expect((await failure(ctx.service.login({ username: 'plac123', password: TEST_PASSWORD }, META))).code).toBe('invalid_credentials');
  });
});

describe('external accounts never get a local password', () => {
  it('refuses setPassword on a provisioned seller, keeping its hash, sessions and audit untouched', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    const first = await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    const [before] = await ctx.db.select().from(account).where(eq(account.id, first.user.accountId));
    const { accounts } = createOperatorAccountService(ctx.database.handle, TEST_HASH_PARAMS, ctx.clock.fn);

    await expect(accounts.setPassword(first.user.accountId, TEST_PASSWORD)).rejects.toBeInstanceOf(ExternalAccountPasswordError);

    const [after] = await ctx.db.select().from(account).where(eq(account.id, first.user.accountId));
    expect(after?.passwordHash).toBe(before?.passwordHash);
    const [live] = await ctx.db.select().from(session).where(eq(session.accountId, first.user.accountId));
    expect(live?.revokedAt).toBeNull();
    expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'account.password_changed'))).toHaveLength(0);
  });

  it('refuses setPassword on any account carrying an external user id, whatever its role', async () => {
    const ctx = await setup();
    const admin = await preLink(ctx, { username: 'adm', externalUserId: '9000', role: 'admin' });
    const { accounts } = createOperatorAccountService(ctx.database.handle, TEST_HASH_PARAMS, ctx.clock.fn);
    await expect(accounts.setPassword(admin.id, 'Another-Sturdy-Passphrase-1')).rejects.toThrow(/ERP|Sankhya/);
  });

  it('keeps setPassword working for a local admin', async () => {
    const ctx = await setup();
    const admin = await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    const { accounts } = createOperatorAccountService(ctx.database.handle, TEST_HASH_PARAMS, ctx.clock.fn);
    await accounts.setPassword(admin.id, 'Another-Sturdy-Passphrase-1');
    const result = await ctx.service.login({ username: 'admin', password: 'Another-Sturdy-Passphrase-1' }, META);
    expect(result.user.accountId).toBe(admin.id);
  });

  it('refuses the repository write itself for an external account (race-safe, no silent no-op)', async () => {
    const ctx = await setup();
    const linked = await preLink(ctx, { username: 'x', externalUserId: '1' });
    const repository = new AccountRepository(ctx.db);
    expect(await repository.updatePasswordHash(linked.id, 'whatever-hash')).toBe(false);
    const local = await createTestAccount(ctx.database.handle, { username: 'local', role: 'admin' }, ctx.clock.fn);
    expect(await repository.updatePasswordHash(local.id, 'whatever-hash')).toBe(true);
  });

  it.each([[false], [true]])('login never verifies a local hash for an account with an external id (directory enabled: %s)', async (external) => {
    const ctx = await setup({ external });
    // A genuine, valid Argon2id hash of TEST_PASSWORD on an external account: it must still never authenticate.
    await preLink(ctx, { username: 'admin', externalUserId: '9000', role: 'admin' });
    const err = await failure(ctx.service.login({ username: 'admin', password: TEST_PASSWORD }, META));
    expect(err.code).toBe('invalid_credentials');
    expect(await ctx.db.select().from(session)).toHaveLength(0);
    const reasons = (await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.login.failure'))).map((r) => (r.detail as { reason: string }).reason);
    expect(reasons).toEqual([external ? 'external_invalid_credentials' : 'external_account_local_login']);
  });

  it('the unusable handle of a provisioned account never signs in locally', async () => {
    const ctx = await setup(AUTO);
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    await ctx.service.login({ username: 'plac123', password: SANKHYA_PASSWORD }, META);
    for (const password of ['!external-directory-account', TEST_PASSWORD, SANKHYA_PASSWORD]) {
      expect((await failure(ctx.service.login({ username: 'sankhya:4501', password }, META))).code).toBe('invalid_credentials');
    }
    expect(await ctx.db.select().from(session)).toHaveLength(1);
  });
});

describe('failure latency floor (directory enabled only)', () => {
  const originalNow = failureFloor.now;
  const originalSleep = failureFloor.sleep;
  const sleeps: number[] = [];
  const freeze = () => {
    sleeps.length = 0;
    failureFloor.now = () => 1_000_000;
    failureFloor.sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
  };
  afterEach(() => {
    failureFloor.now = originalNow;
    failureFloor.sleep = originalSleep;
  });

  it('pads a known local user with a wrong password', async () => {
    const ctx = await setup({ minFailureMs: 250 });
    await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    freeze();
    await failure(ctx.service.login({ username: 'admin', password: WRONG_PASSWORD }, META));
    expect(sleeps).toEqual([250]);
  });

  it('pads an unknown user that goes to the directory and is refused there (one floor, not two)', async () => {
    const ctx = await setup({ minFailureMs: 250 });
    freeze();
    await failure(ctx.service.login({ username: 'ghost', password: WRONG_PASSWORD }, META));
    expect(sleeps).toEqual([250]);
  });

  it('pads an invalid directory password for an existing directory user', async () => {
    const ctx = await setup({ minFailureMs: 250, ...AUTO });
    await addSeller(ctx, 103, 'Vendedor Sintetico');
    await directoryUser(ctx, 'plac123', 4501, 103);
    freeze();
    await failure(ctx.service.login({ username: 'plac123', password: WRONG_PASSWORD }, META));
    expect(sleeps).toEqual([250]);
  });

  it('pads a disabled or channel-refused local account like any other local failure', async () => {
    const ctx = await setup({ minFailureMs: 250 });
    const admin = await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    await ctx.db.update(account).set({ status: 'disabled' }).where(eq(account.id, admin.id));
    freeze();
    await failure(ctx.service.login({ username: 'admin', password: TEST_PASSWORD }, META));
    expect(sleeps).toEqual([250]);
  });

  it('subtracts the time already spent (the floor is a minimum, not an addition)', async () => {
    const ctx = await setup({ minFailureMs: 250 });
    await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    sleeps.length = 0;
    let calls = 0;
    failureFloor.now = () => 1_000_000 + (calls++ === 0 ? 0 : 100);
    failureFloor.sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    await failure(ctx.service.login({ username: 'admin', password: WRONG_PASSWORD }, META));
    expect(sleeps).toEqual([150]);
  });

  it('does not pad a successful login', async () => {
    const ctx = await setup({ minFailureMs: 250 });
    await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    freeze();
    await ctx.service.login({ username: 'admin', password: TEST_PASSWORD }, META);
    expect(sleeps).toEqual([]);
  });

  it('does not change anything when the directory login is disabled', async () => {
    const ctx = await setup({ external: false });
    await createTestAccount(ctx.database.handle, { username: 'admin', role: 'admin' }, ctx.clock.fn);
    freeze();
    await failure(ctx.service.login({ username: 'admin', password: WRONG_PASSWORD }, META));
    await failure(ctx.service.login({ username: 'ghost', password: WRONG_PASSWORD }, META));
    expect(sleeps).toEqual([]);
  });
});

describe('SankhyaIdentityVerifier (client of the internal verifier)', () => {
  const secret = new CredentialSecret('s'.repeat(40));
  const credentials = { login: 'plac123', password: new CredentialSecret(SANKHYA_PASSWORD) };
  const signal = new AbortController().signal;
  const make = (respond: () => Response | Promise<Response>) =>
    new SankhyaIdentityVerifier({ url: 'http://verifier:3002/', sharedSecret: secret, fetchImpl: (() => Promise.resolve(respond())) as unknown as typeof fetch });

  it('maps an identity, a denial, a rate limit and every other outcome fail-closed', async () => {
    const identity = { ok: true, externalUserId: '4501', username: 'plac123', active: true, verifiedAt: '2026-10-05T00:00:00.000Z' };
    expect(await make(() => Response.json(identity)).verify(credentials, signal)).toEqual({
      ok: { externalUserId: '4501', displayName: '', sellerCode: null, active: true },
    });
    expect(await make(() => Response.json({ ok: false, code: 'denied' }, { status: 403 })).verify(credentials, signal)).toEqual({ fail: 'invalid_credentials' });
    expect(await make(() => Response.json({ ok: false, code: 'rate_limited' }, { status: 429 })).verify(credentials, signal)).toEqual({ fail: 'rate_limited' });
    expect(await make(() => Response.json({ ok: false, code: 'unavailable' }, { status: 503 })).verify(credentials, signal)).toEqual({ fail: 'unavailable' });
    expect(await make(() => Response.json({ ok: false, code: 'unauthorized' }, { status: 401 })).verify(credentials, signal)).toEqual({ fail: 'unavailable' });
    expect(await make(() => Response.json({ nonsense: true })).verify(credentials, signal)).toEqual({ fail: 'unavailable' });
    expect(await make(() => new Response('not json', { status: 200 })).verify(credentials, signal)).toEqual({ fail: 'unavailable' });
    expect(await make(() => { throw new Error('ECONNREFUSED'); }).verify(credentials, signal)).toEqual({ fail: 'unavailable' });
  });
});
