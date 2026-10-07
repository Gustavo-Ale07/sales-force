import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { isValidSellerCode, normalizeUsername } from '@salesforce/domain';
import type { LoginResponse as AuthenticatedSession } from '@salesforce/contracts';
import { AppError } from '../http/app-error.js';
import { errorLogFields, type Logger } from '../observability/logger.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, LOGGER, type Clock } from '../platform/tokens.js';
import { AccountRepository } from './account.repository.js';
import { AuditSampler } from './audit-sampler.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import type { AuthConfig } from './auth-config.js';
import type { CurrentUser } from './current-user.js';
import { HashLimiter } from './hash-limiter.js';
import {
  CredentialSecret,
  type ExternalAccountLinks,
  type ExternalIdentity,
  type ExternalIdentityVerifier,
  type ExternalVerifyResult,
} from './external-identity.js';
import { AUTH_CONFIG, EXTERNAL_ACCOUNT_LINKS, EXTERNAL_IDENTITY_VERIFIER, PASSWORD_HASHER } from './iam-tokens.js';
import type { PasswordHasher } from './password-hasher.js';
import { isChannelAllowed, type Channel } from './policy.js';
import { SessionRepository } from './session.repository.js';
import {
  constantTimeEqualHex,
  externalLoginThrottleKey,
  generateSessionToken,
  hashSessionToken,
  ipThrottleKey,
  looksLikeSessionToken,
  loginNameFingerprint,
  loginNameThrottleKey,
} from './session-crypto.js';
import { failureFloor, padFailure } from './failure-floor.js';
import { activeLockUntil } from './throttle-policy.js';
import { ThrottleRepository } from './throttle.repository.js';

/** What the HTTP layer knows about the caller. Never the body or headers of the request. */
export interface RequestMeta {
  readonly ip: string;
  readonly userAgent: string | undefined;
  readonly requestId: string;
}

export interface LoginResult {
  /** The plain session token: goes into the cookie and nowhere else (never the body, never a log). */
  readonly token: string;
  readonly user: CurrentUser;
}

export interface ResolvedSession {
  readonly user: CurrentUser;
  /** True when the expiry was slid on this request: the browser cookie must be re-issued with the new lifetime. */
  readonly renewed: boolean;
}

/** Why a login attempt failed. Recorded in the audit trail only; the client always sees the same error. */
export type LoginFailureReason =
  | 'unknown_account'
  | 'bad_password'
  | 'external_account_local_login'
  | 'account_disabled'
  | 'channel_not_permitted'
  | 'mode_role_not_permitted'
  | 'external_invalid_credentials'
  | 'external_unmapped'
  | 'external_inactive'
  | 'external_account_disabled'
  | 'external_channel_not_permitted'
  | 'external_mode_role_not_permitted'
  | 'external_link_mismatch'
  | 'external_seller_inactive'
  | 'external_unavailable'
  | 'external_rate_limited';

const PURGE_INTERVAL_MS = 10 * 60 * 1000;
/** Installation-wide counter of failed password checks (`auth_throttle`); one row, fixed window. */
const GLOBAL_FAILURES_KEY = 'global:login-failures';
/** Same, for external-directory logins: kept apart so one flow cannot exhaust the other's budget. */
const EXTERNAL_GLOBAL_FAILURES_KEY = 'global:external-login-failures';
const EXTERNAL_LOGIN_MAX = 254;
const EXTERNAL_PASSWORD_MAX = 1024;
const EXTERNAL_RATE_LIMIT_RETRY_AFTER_SECONDS = 30;

const GLOBAL_WINDOW_MS = 60_000;
/** A login refused because every Argon2id slot is busy is worth retrying almost at once. */
const SATURATED_RETRY_AFTER_SECONDS = 1;

/** Why a login was refused before any password work. Audit only: the client always sees `rate_limited`. */
type RefusalScope = 'ip' | 'account' | 'global' | 'saturated';
const USER_AGENT_MAX = 200;

function retryAfterSeconds(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

/**
 * Login, session resolution and logout (P-11, AUTH-1, RF-IAM-1/2/9). Orchestration only: the
 * throttling arithmetic is in `throttle-policy.ts`, the password rules in `password-policy.ts`, who
 * may do what in `policy.ts`.
 *
 * Enumeration: an unknown user name, a wrong password, a disabled account and a channel-restricted
 * account all end in the same `invalid_credentials` after the same work (a full Argon2id
 * verification, the same counters); lockout is keyed by the login-name hash so it applies identically
 * to registered and unregistered names. With the directory login enabled every failure path also answers no sooner
 * than `externalLogin.minFailureMs` (measured from the start of the attempt), so latency does not tell them apart.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  #lastPurgeAt = 0;
  readonly #hashSlots: HashLimiter;
  readonly #refusalSampler: AuditSampler;
  /** Verifier calls in flight at once (bounds the load one flood can put on the directory). */
  readonly #verifySlots: HashLimiter;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(ThrottleRepository) private readonly throttle: ThrottleRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Optional() @Inject(EXTERNAL_IDENTITY_VERIFIER) private readonly externalVerifier?: ExternalIdentityVerifier,
    @Optional() @Inject(EXTERNAL_ACCOUNT_LINKS) private readonly externalLinks?: ExternalAccountLinks,
  ) {
    this.#hashSlots = new HashLimiter(config.login.maxConcurrentHashes);
    this.#verifySlots = new HashLimiter(config.login.maxConcurrentHashes);
    this.#refusalSampler = new AuditSampler(config.login.blockedAuditWindowMs);
  }

  /** Computes the throw-away hash of unknown accounts once, before the first login arrives. */
  async onModuleInit(): Promise<void> {
    await this.hasher.warmUp();
  }

  /**
   * Login by user name + password. Order: the LOCAL account (admin/technical, Argon2id) first; a name that is not a
   * local account usable in this mode goes to the external directory flow when it is enabled (`loginExternal`),
   * which is how a directory-linked (seller) account signs in (an unlinked local seller account still verifies its local password when the role is allowed in the mode). A wrong password or a disabled LOCAL account
   * never falls through to the directory: the local verdict is final. With the directory disabled the failure is
   * the same uniform `invalid_credentials`. An account linked to a directory user (`externalUserId`) never verifies a
   * local hash: it is treated like an unknown name (dummy verification) and goes to the directory when enabled.
   */
  async login(input: { username: string; password: string }, meta: RequestMeta): Promise<LoginResult> {
    const startedAt = failureFloor.now();
    const now = this.clock();
    const username = normalizeUsername(input.username);
    // Local accounts are matched case-insensitively (unique index on lower of the legacy login column); the directory always receives `username` exactly as typed.
    const loginName = username.toLowerCase();
    const loginKey = loginNameThrottleKey(loginName);
    const ipKey = ipThrottleKey(meta.ip);
    const auditMeta = { ip: meta.ip, userAgent: meta.userAgent?.slice(0, USER_AGENT_MAX) ?? null, requestId: meta.requestId };
    // Minimum failure duration, only while the directory login is on (otherwise behaviour is unchanged).
    const floorMs = this.config.externalLogin?.enabled === true ? this.config.externalLogin.minFailureMs : 0;

    // 1. Refusals before any password work (bounds the CPU and the writes an attacker can cause):
    // a locked key, an exhausted installation-wide failure budget, or no free Argon2id slot.
    const [ipState, loginState, globalState] = await Promise.all([
      this.throttle.find(ipKey),
      this.throttle.find(loginKey),
      this.throttle.find(GLOBAL_FAILURES_KEY),
    ]);
    const ipLock = activeLockUntil(ipState, now);
    const loginLock = activeLockUntil(loginState, now);
    if (ipLock !== null || loginLock !== null) {
      const until = [ipLock, loginLock].filter((value): value is Date => value !== null).reduce((a, b) => (a > b ? a : b));
      await this.refuse(ipLock !== null ? 'ip' : 'account', retryAfterSeconds(until, now), loginName, auditMeta, now);
    }
    if (
      globalState !== null &&
      now.getTime() - globalState.windowStartedAt.getTime() < GLOBAL_WINDOW_MS &&
      globalState.failures >= this.config.login.globalMaxFailuresPerMinute
    ) {
      const windowEnd = new Date(globalState.windowStartedAt.getTime() + GLOBAL_WINDOW_MS);
      await this.refuse('global', retryAfterSeconds(windowEnd, now), loginName, auditMeta, now);
    }
    const releaseSlot = this.#hashSlots.tryAcquire();
    if (releaseSlot === null) {
      await this.refuse('saturated', SATURATED_RETRY_AFTER_SECONDS, loginName, auditMeta, now);
    }

    // 2. Verify. An unknown account verifies against a throw-away hash (same cost). The slot covers
    // the account lookup and the hash: those are what a flood would pile up.
    let found: Awaited<ReturnType<AccountRepository['findByUsername']>>;
    let passwordOk: boolean;
    try {
      found = await this.accounts.findByUsername(loginName);
      // An account linked to a directory user has no local password: its stored hash is never checked (dummy work instead).
      passwordOk = await this.hasher.verify(found !== null && found.externalUserId === null ? found.passwordHash : null, input.password);
    } finally {
      releaseSlot?.();
    }
    let failure: LoginFailureReason | null = null;
    if (found === null) failure = 'unknown_account';
    else if (found.externalUserId !== null) failure = 'external_account_local_login';
    else if (!passwordOk) failure = 'bad_password';
    else if (found.status !== 'active') failure = 'account_disabled';
    else if (!isChannelAllowed(found.role, 'web')) failure = 'channel_not_permitted';
    else if (!this.roleMayHoldSession(found.role)) failure = 'mode_role_not_permitted';

    // Only a name with no local account (or one linked to a directory user) reaches the directory: a local verdict (wrong
    // password, disabled account, role not admitted) is final and a local password is never forwarded.
    if (
      (failure === 'unknown_account' || failure === 'external_account_local_login') &&
      this.config.externalLogin?.enabled === true &&
      this.externalVerifier !== undefined &&
      this.externalLinks !== undefined
    ) {
      return this.runExternalLogin({ login: username, password: input.password }, meta, undefined, startedAt);
    }

    if (failure !== null || found === null) {
      await this.recordFailure({ reason: failure ?? 'unknown_account', accountId: found?.id ?? null, loginName, loginKey, ipKey, now, auditMeta });
      await padFailure(startedAt, floorMs);
      throw new AppError('invalid_credentials');
    }
    // Defense in depth: nothing below may ever run for an account linked to a directory user.
    if (found.externalUserId !== null) throw new AppError('invalid_credentials');

    // 3. Success: upgrade the hash if the cost parameters moved, open the session, then forget the failures
    // of this e-mail (the address counter is not reset by a success).
    if (this.hasher.needsRehash(found.passwordHash)) {
      try {
        await this.accounts.updatePasswordHash(found.id, await this.hasher.hash(input.password));
      } catch (error) {
        this.logger.warn({ ...errorLogFields(error), accountId: found.id }, 'password hash upgrade failed; keeping the old hash');
      }
    }

    const token = generateSessionToken();
    const sessionId = uuidv7(now.getTime());
    const expiresAt = new Date(now.getTime() + Math.min(this.config.sessionIdleMs, this.config.sessionAbsoluteMs));
    await this.openAuditedSession(
      { id: sessionId, accountId: found.id, tokenHash: hashSessionToken(token), createdAt: now, expiresAt },
      { ...auditMeta, sessionId },
    );
    await this.throttle.clear(loginKey);
    await this.maybePurge(now);

    const user: CurrentUser = {
      accountId: found.id,
      username: found.username,
      displayName: found.displayName,
      role: found.role,
      sellerCodes: await this.accounts.sellerCodesOf(found.id),
      sessionId,
      sessionExpiresAt: expiresAt,
      channel: 'web',
    };
    return { token, user };
  }

  /**
   * Login with the credentials of an EXTERNAL directory (the ERP user), verified through the
   * `ExternalIdentityVerifier` port. Not wired to any route or to `AUTH_MODE`; refused (503) unless
   * `config.externalLogin.enabled` and both ports are present, which no real runtime provides today.
   *
   * Order: input shape -> throttles (address, login hash, installation) -> verifier -> explicit
   * account link -> account status/channel -> link reconciliation -> new opaque session. Throttles are checked BEFORE the
   * verifier so a locked login never reaches the directory. A directory outage fails closed (503, no
   * session): there is no local-hash fallback. Every credential-class failure ends in the same
   * `invalid_credentials` after at least `minFailureMs`. Accounts are never created or promoted here,
   * and the directory's seller code never grants scope (the account's own seller link does).
   */
  async loginExternal(
    input: { login: string; password: string },
    meta: RequestMeta,
    signal?: AbortSignal,
  ): Promise<LoginResult> {
    return this.runExternalLogin(input, meta, signal, failureFloor.now());
  }

  /** `startedAt` is when the whole attempt began (a local lookup may precede the directory call), so the floor covers both. */
  private async runExternalLogin(
    input: { login: string; password: string },
    meta: RequestMeta,
    signal: AbortSignal | undefined,
    startedAt: number,
  ): Promise<LoginResult> {
    const settings = this.config.externalLogin;
    const verifier = this.externalVerifier;
    const links = this.externalLinks;
    if (settings?.enabled !== true || verifier === undefined || links === undefined) {
      throw new AppError('service_unavailable');
    }
    const login = input.login.trim();
    if (login === '' || login.length > EXTERNAL_LOGIN_MAX || input.password === '' || input.password.length > EXTERNAL_PASSWORD_MAX) {
      throw new AppError('validation_failed');
    }

    const now = this.clock();
    const normalized = login.toLowerCase();
    const loginKey = externalLoginThrottleKey(normalized);
    const ipKey = ipThrottleKey(meta.ip);
    const auditMeta = { ip: meta.ip, userAgent: meta.userAgent?.slice(0, USER_AGENT_MAX) ?? null, requestId: meta.requestId };

    // 1. Refusals before the verifier is called (it is a remote, rate-limited, shared dependency).
    const [ipState, loginState, globalState] = await Promise.all([
      this.throttle.find(ipKey),
      this.throttle.find(loginKey),
      this.throttle.find(EXTERNAL_GLOBAL_FAILURES_KEY),
    ]);
    const ipLock = activeLockUntil(ipState, now);
    const loginLock = activeLockUntil(loginState, now);
    if (ipLock !== null || loginLock !== null) {
      const until = [ipLock, loginLock].filter((value): value is Date => value !== null).reduce((a, b) => (a > b ? a : b));
      await this.refuse(ipLock !== null ? 'ip' : 'account', retryAfterSeconds(until, now), normalized, auditMeta, now);
    }
    if (
      globalState !== null &&
      now.getTime() - globalState.windowStartedAt.getTime() < GLOBAL_WINDOW_MS &&
      globalState.failures >= this.config.login.globalMaxFailuresPerMinute
    ) {
      const windowEnd = new Date(globalState.windowStartedAt.getTime() + GLOBAL_WINDOW_MS);
      await this.refuse('global', retryAfterSeconds(windowEnd, now), normalized, auditMeta, now);
    }
    const releaseSlot = this.#verifySlots.tryAcquire();
    if (releaseSlot === null) {
      await this.refuse('saturated', SATURATED_RETRY_AFTER_SECONDS, normalized, auditMeta, now);
    }

    // 2. Verify. The password lives in an opaque holder from here on; any verifier error is an outage.
    const timeout = AbortSignal.timeout(settings.verifyTimeoutMs);
    const effective = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let result: ExternalVerifyResult;
    try {
      result = await verifier.verify({ login, password: new CredentialSecret(input.password) }, effective);
    } catch (error) {
      this.logger.warn({ ...errorLogFields(error) }, 'external identity verification failed; refusing the login (fail closed)');
      result = { fail: 'unavailable' };
    } finally {
      releaseSlot?.();
    }

    if ('fail' in result) {
      if (result.fail === 'unavailable') {
        await this.recordExternalNotice('external_unavailable', normalized, auditMeta, now);
        throw new AppError('service_unavailable');
      }
      if (result.fail === 'rate_limited') {
        await this.recordExternalNotice('external_rate_limited', normalized, auditMeta, now);
        throw new AppError('rate_limited', { retryAfterSeconds: EXTERNAL_RATE_LIMIT_RETRY_AFTER_SECONDS });
      }
      return this.failExternal(result.fail === 'unmapped' ? 'external_unmapped' : 'external_invalid_credentials', null, {
        normalized, loginKey, ipKey, now, auditMeta, startedAt, minFailureMs: settings.minFailureMs,
      });
    }

    // 3. Directory user -> existing Force account, by explicit link only.
    const identity: ExternalIdentity = result.ok;
    const failCtx = { normalized, loginKey, ipKey, now, auditMeta, startedAt, minFailureMs: settings.minFailureMs };
    if (identity.active !== true) return this.failExternal('external_inactive', null, failCtx);
    if (typeof identity.externalUserId !== 'string' || identity.externalUserId === '') {
      return this.failExternal('external_unmapped', null, failCtx);
    }
    let accountId = await links.findAccountId(identity.externalUserId);
    if (
      accountId === null &&
      (settings.linkMode ?? 'PRE_LINKED') === 'VERIFIED_AUTO_PROVISION' &&
      isValidSellerCode(identity.sellerCode) &&
      this.roleMayHoldSession('seller')
    ) {
      // Explicit VERIFIED_AUTO_PROVISION only (never the default). First sign-in of a verified directory user: only a `seller` account is ever provisioned, and only for an
      // active, still unlinked mirrored seller (the port enforces it). Anything else stays an unmapped failure.
      try {
        accountId = await links.provisionSeller({ externalUserId: identity.externalUserId, sellerCode: identity.sellerCode, now });
      } catch (error) {
        this.logger.warn({ ...errorLogFields(error) }, 'could not provision the seller account of an external login');
        accountId = null;
      }
    }
    const found = accountId === null ? null : await this.accounts.findById(accountId);
    if (found === null) return this.failExternal('external_unmapped', null, failCtx);
    if (found.status !== 'active') return this.failExternal('external_account_disabled', found.id, failCtx);
    if (!isChannelAllowed(found.role, 'web')) return this.failExternal('external_channel_not_permitted', found.id, failCtx);
    // Same mode restriction as the password login and the session reads: a role the mode does not admit never gets a session.
    if (!this.roleMayHoldSession(found.role)) return this.failExternal('external_mode_role_not_permitted', found.id, failCtx);

    // 4. Link reconciliation, fail closed. The login proves ONLY the directory identity; scope comes only from the
    // account's own seller link (never from the directory, a name or the login). A seller account must have a link.
    // A directory seller code is optional extra evidence (the live verifier gives none: `null` is not a mismatch):
    // when present it must agree with the link, and for an account without that link it is a contradiction.
    // admin/manager/technical need no link. Credentials were valid, so this is not
    // reveal that: the client gets the same uniform invalid_credentials as a wrong password (padded, and
    // counted against the per-login/IP throttles). The specific reason lives only in the audit rows.
    const sellerCodes = await this.accounts.sellerCodesOf(found.id);
    const directoryCode = identity.sellerCode;
    const linked = sellerCodes.filter(isValidSellerCode);
    let linkProblem: 'no_link' | 'mismatch' | null = null;
    if (found.role === 'seller') {
      if (linked.length === 0) linkProblem = 'no_link';
    }
    if (linkProblem === null && isValidSellerCode(directoryCode) && !linked.includes(directoryCode)) {
      linkProblem = linked.length === 0 ? 'no_link' : 'mismatch';
    }
    if (linkProblem !== null) {
      try {
        await this.audit.record({
          action: AUDIT_ACTIONS.loginLinkMismatch,
          actorAccountId: found.id,
          detail: { ...auditMeta, reason: linkProblem, method: 'external' },
        });
      } catch (error) {
        this.logger.warn({ ...errorLogFields(error) }, 'could not record an external link mismatch');
      }
      return this.failExternal('external_link_mismatch', found.id, failCtx);
    }
    // Authentication is not authorization: a seller whose ERP record is inactive, deleted or gone from the mirror
    // never gets a session, however valid the directory credentials are.
    if (found.role === 'seller') {
      let sellersActive = true;
      for (const code of linked) {
        if (!(await links.isSellerActive(code))) sellersActive = false;
      }
      if (!sellersActive) return this.failExternal('external_seller_inactive', found.id, failCtx);
    }

    const token = generateSessionToken();
    const sessionId = uuidv7(now.getTime());
    const expiresAt = new Date(now.getTime() + Math.min(this.config.sessionIdleMs, this.config.sessionAbsoluteMs));
    await this.openAuditedSession(
      { id: sessionId, accountId: found.id, tokenHash: hashSessionToken(token), createdAt: now, expiresAt },
      { ...auditMeta, sessionId, method: 'external' },
    );
    await this.throttle.clear(loginKey);
    await this.maybePurge(now);

    return {
      token,
      user: {
        accountId: found.id,
        username: found.username,
        displayName: found.displayName,
        role: found.role,
        sellerCodes,
        sessionId,
        sessionExpiresAt: expiresAt,
        channel: 'web',
      },
    };
  }

  /**
   * Resolves the session behind a cookie value, or `null`. Checked on every request: token known,
   * not revoked, not expired (idle or absolute), account active. Slides the expiry (rewritten at
   * most once per `sessionTouchIntervalMs`). The channel rule is the policy's job (`authorizeRoute`).
   */
  async resolveSession(token: string | undefined, channel: Channel = 'web'): Promise<ResolvedSession | null> {
    if (token === undefined || !looksLikeSessionToken(token)) return null;
    const tokenHash = hashSessionToken(token);
    const row = await this.sessions.findByTokenHash(tokenHash);
    if (row === null || !constantTimeEqualHex(row.tokenHash, tokenHash)) return null;

    const now = this.clock();
    if (row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime() || row.status !== 'active') return null;
    if (!this.roleMayHoldSession(row.role)) return null;

    let expiresAt = row.expiresAt;
    let renewed = false;
    if (now.getTime() - row.lastSeenAt.getTime() >= this.config.sessionTouchIntervalMs) {
      expiresAt = new Date(
        Math.min(now.getTime() + this.config.sessionIdleMs, row.createdAt.getTime() + this.config.sessionAbsoluteMs),
      );
      await this.sessions.touch(row.sessionId, now, expiresAt);
      renewed = true;
    }
    return {
      renewed,
      user: {
        accountId: row.accountId,
        username: row.username,
        displayName: row.displayName,
        role: row.role,
        sellerCodes: await this.accounts.sellerCodesOf(row.accountId),
        sessionId: row.sessionId,
        sessionExpiresAt: expiresAt,
        channel,
      },
    };
  }

  /**
   * The role of the live session behind a token, or `null`. Read only: it never slides the expiry and
   * never writes (for public endpoints that show more to some signed-in callers, such as `/ready`);
   * the caller still asks the central policy (`authorizeRoute`) what that role may see.
   */
  async peekSession(token: string | undefined): Promise<{ readonly role: string } | null> {
    if (token === undefined || !looksLikeSessionToken(token)) return null;
    const tokenHash = hashSessionToken(token);
    const row = await this.sessions.findByTokenHash(tokenHash);
    if (row === null || !constantTimeEqualHex(row.tokenHash, tokenHash)) return null;
    const live = row.revokedAt === null && row.expiresAt.getTime() > this.clock().getTime() && row.status === 'active';
    return live && this.roleMayHoldSession(row.role) ? { role: row.role } : null;
  }

  async logout(user: CurrentUser, meta: RequestMeta): Promise<void> {
    const now = this.clock();
    await this.sessions.revoke(user.sessionId, now);
    await this.audit.record({
      action: AUDIT_ACTIONS.logout,
      actorAccountId: user.accountId,
      detail: { sessionId: user.sessionId, ip: meta.ip, requestId: meta.requestId },
    });
  }

  /**
   * Successful login (AUDIT-1, APPROVED 2026-10-02): the `auth.login.success` audit row is MANDATORY and is
   * written in the same transaction as the session row. If either write fails nothing is committed: no
   * session row, so no cookie is issued (the caller never reaches the token), and the client gets a
   * generic 503 `service_unavailable`. Only the error class is logged (never the account, e-mail or address),
   * and no throttle counter moves: it is not a credential failure and must not be an enumerable difference
   * (it only ever happens after the credentials were fully verified). This is the opposite of the refused-login
   * path, where audit is best effort (`recordAuditBestEffort`). Applied to every successful login whatever the
   * mode or role, so the dev mode behaves the same as `local`.
   */
  private async openAuditedSession(
    values: { id: string; accountId: string; tokenHash: string; createdAt: Date; expiresAt: Date },
    detail: Parameters<AuditService['record']>[0]['detail'],
  ): Promise<void> {
    try {
      await this.sessions.createWithAudit(values, (writer) =>
        this.audit.record({ action: AUDIT_ACTIONS.loginSuccess, actorAccountId: values.accountId, detail }, writer),
      );
    } catch (error) {
      this.logger.error({ ...errorLogFields(error) }, 'could not record the mandatory login audit event; no session was created (fail closed)');
      throw new AppError('service_unavailable');
    }
  }

  /** Mode restriction on top of the channel rule: `local` admits only its allowed roles (undefined = every role). */
  private roleMayHoldSession(role: string): boolean {
    const allowed = this.config.allowedRoles;
    return allowed === undefined || (allowed as readonly string[]).includes(role);
  }

  /** The contract body of an authenticated session. Explicit fields only: the domain type is never serialized. */
  toSessionBody(user: CurrentUser): AuthenticatedSession {
    return {
      authenticated: true,
      authMode: this.config.authMode,
      account: {
        id: user.accountId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        sellerCodes: [...user.sellerCodes],
      },
      expiresAt: user.sessionExpiresAt.toISOString(),
    };
  }

  /** A credential-class external failure: counted, audited, padded to the minimum duration, uniform error. */
  private async failExternal(
    reason: LoginFailureReason,
    accountId: string | null,
    ctx: {
      normalized: string;
      loginKey: string;
      ipKey: string;
      now: Date;
      auditMeta: { ip: string; userAgent: string | null; requestId: string };
      startedAt: number;
      minFailureMs: number;
    },
  ): Promise<never> {
    await this.recordFailure({
      reason,
      accountId,
      loginName: ctx.normalized,
      loginKey: ctx.loginKey,
      ipKey: ctx.ipKey,
      now: ctx.now,
      auditMeta: ctx.auditMeta,
      globalKey: EXTERNAL_GLOBAL_FAILURES_KEY,
    });
    await padFailure(ctx.startedAt, ctx.minFailureMs);
    throw new AppError('invalid_credentials');
  }

  /**
   * An outage or an upstream rate limit is not a credential failure: no counter moves (so an outage
   * cannot lock users out), and the audit row is sampled like refused attempts.
   */
  private async recordExternalNotice(
    reason: 'external_unavailable' | 'external_rate_limited',
    normalized: string,
    auditMeta: { ip: string; userAgent: string | null; requestId: string },
    now: Date,
  ): Promise<void> {
    const sample = this.#refusalSampler.observe(reason, now);
    if (!sample.record) return;
    try {
      await this.audit.record({
        action: AUDIT_ACTIONS.loginFailure,
        actorAccountId: null,
        detail: { ...auditMeta, reason, emailFingerprint: loginNameFingerprint(normalized), attemptsInWindow: sample.count },
      });
    } catch (error) {
      this.logger.warn({ ...errorLogFields(error), reason }, 'could not record an external login notice');
    }
  }

  /**
   * Failure-path audit writes are best effort: if the audit store is down the caller still gets the
   * uniform `invalid_credentials` (never a 500 that tells a probe apart), after the counters moved.
   * Only the error class/fields and the failure reason are logged (no login, e-mail or address).
   * It calls the store directly, so a failing write cannot recurse into the failure path.
   */
  private async recordAuditBestEffort(reason: LoginFailureReason, event: Parameters<AuditService['record']>[0]): Promise<void> {
    try {
      await this.audit.record(event);
    } catch (error) {
      this.logger.error({ ...errorLogFields(error), reason }, 'could not record a login failure audit event (the login is still refused)');
    }
  }

  private async recordFailure(input: {
    reason: LoginFailureReason;
    accountId: string | null;
    loginName: string;
    loginKey: string;
    ipKey: string;
    now: Date;
    auditMeta: { ip: string; userAgent: string | null; requestId: string };
    globalKey?: string;
  }): Promise<void> {
    const account = await this.throttle.recordFailure(input.loginKey, input.now, this.config.throttle.account);
    const ip = await this.throttle.recordFailure(input.ipKey, input.now, this.config.throttle.ip);
    await this.throttle.bumpWindow(input.globalKey ?? GLOBAL_FAILURES_KEY, input.now, GLOBAL_WINDOW_MS);

    await this.recordAuditBestEffort(input.reason, {
      action: AUDIT_ACTIONS.loginFailure,
      actorAccountId: input.accountId,
      detail: {
        ...input.auditMeta,
        reason: input.reason,
        // Attacker-chosen text is never stored: a short fingerprint lets an investigator correlate.
        ...(input.accountId === null ? { emailFingerprint: loginNameFingerprint(input.loginName) } : {}),
      },
    });
    if (account.lockedNow) {
      await this.recordAuditBestEffort(input.reason, {
        action: AUDIT_ACTIONS.lockout,
        actorAccountId: input.accountId,
        detail: {
          scope: 'account',
          lockoutCount: account.state.lockoutCount,
          lockedUntil: account.state.lockedUntil?.toISOString() ?? null,
          ip: input.auditMeta.ip,
          emailFingerprint: loginNameFingerprint(input.loginName),
        },
      });
    }
    if (ip.lockedNow) {
      await this.recordAuditBestEffort(input.reason, {
        action: AUDIT_ACTIONS.lockout,
        actorAccountId: null,
        detail: { scope: 'ip', ip: input.auditMeta.ip, lockedUntil: ip.state.lockedUntil?.toISOString() ?? null },
      });
    }
    await this.maybePurge(input.now);
  }

  /**
   * Refuses a login before any password work: 429 `rate_limited` with `Retry-After`, no counter is
   * touched. The audit row is SAMPLED (1st, 2nd, 4th, 8th ... refusal per scope and window, carrying
   * the running count) so that a flood of refused attempts cannot flood the audit trail or the
   * database with writes.
   */
  private async refuse(
    scope: RefusalScope,
    retryAfter: number,
    loginName: string,
    auditMeta: { ip: string; userAgent: string | null; requestId: string },
    now: Date,
  ): Promise<never> {
    const sample = this.#refusalSampler.observe(scope, now);
    if (sample.record) {
      try {
        await this.audit.record({
          action: AUDIT_ACTIONS.loginBlocked,
          actorAccountId: null,
          detail: { ...auditMeta, scope, emailFingerprint: loginNameFingerprint(loginName), attemptsInWindow: sample.count },
        });
      } catch (error) {
        this.logger.warn({ ...errorLogFields(error), scope }, 'could not record a refused login attempt');
      }
    }
    throw new AppError('rate_limited', { retryAfterSeconds: retryAfter });
  }

  /** Keeps `auth_throttle` and `session` bounded without a scheduler: at most once per interval per process. */
  private async maybePurge(now: Date): Promise<void> {
    if (now.getTime() - this.#lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.#lastPurgeAt = now.getTime();
    try {
      await this.throttle.purgeStale(now);
      await this.sessions.purge(now);
    } catch (error) {
      this.logger.warn({ ...errorLogFields(error) }, 'auth housekeeping failed');
    }
  }
}
