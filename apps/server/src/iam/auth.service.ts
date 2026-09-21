import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail } from '@salesforce/domain';
import type { LoginResponse as AuthenticatedSession } from '@salesforce/contracts';
import { AppError } from '../http/app-error.js';
import type { Logger } from '../observability/logger.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, LOGGER, type Clock } from '../platform/tokens.js';
import { AccountRepository } from './account.repository.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import type { AuthConfig } from './auth-config.js';
import type { CurrentUser } from './current-user.js';
import { AUTH_CONFIG, PASSWORD_HASHER } from './iam-tokens.js';
import type { PasswordHasher } from './password-hasher.js';
import { isChannelAllowed, type Channel } from './policy.js';
import { SessionRepository } from './session.repository.js';
import {
  constantTimeEqualHex,
  emailFingerprint,
  emailThrottleKey,
  generateSessionToken,
  hashSessionToken,
  ipThrottleKey,
  looksLikeSessionToken,
} from './session-crypto.js';
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
export type LoginFailureReason = 'unknown_account' | 'bad_password' | 'account_disabled' | 'channel_not_permitted';

const PURGE_INTERVAL_MS = 10 * 60 * 1000;
const USER_AGENT_MAX = 200;

function retryAfterSeconds(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

/**
 * Login, session resolution and logout (P-11, AUTH-1, RF-IAM-1/2/9). Orchestration only: the
 * throttling arithmetic is in `throttle-policy.ts`, the password rules in `password-policy.ts`, who
 * may do what in `policy.ts`.
 *
 * Enumeration: an unknown e-mail, a wrong password, a disabled account and a channel-restricted
 * account all end in the same `invalid_credentials` after the same work (a full Argon2id
 * verification, the same counters); lockout is keyed by the e-mail hash so it applies identically
 * to registered and unregistered addresses.
 */
@Injectable()
export class AuthService {
  #lastPurgeAt = 0;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(ThrottleRepository) private readonly throttle: ThrottleRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async login(input: { email: string; password: string }, meta: RequestMeta): Promise<LoginResult> {
    const now = this.clock();
    const email = normalizeEmail(input.email);
    const emailKey = emailThrottleKey(email);
    const ipKey = ipThrottleKey(meta.ip);
    const auditMeta = { ip: meta.ip, userAgent: meta.userAgent?.slice(0, USER_AGENT_MAX) ?? null, requestId: meta.requestId };

    // 1. Blocked keys are rejected before any password work (bounds the CPU an attacker can spend).
    const [ipState, emailState] = await Promise.all([this.throttle.find(ipKey), this.throttle.find(emailKey)]);
    const ipLock = activeLockUntil(ipState, now);
    const emailLock = activeLockUntil(emailState, now);
    if (ipLock !== null || emailLock !== null) {
      const until = [ipLock, emailLock].filter((value): value is Date => value !== null).reduce((a, b) => (a > b ? a : b));
      await this.audit.record({
        action: AUDIT_ACTIONS.loginBlocked,
        actorAccountId: null,
        detail: {
          ...auditMeta,
          scope: ipLock !== null ? 'ip' : 'account',
          emailFingerprint: emailFingerprint(email),
        },
      });
      throw new AppError('rate_limited', { retryAfterSeconds: retryAfterSeconds(until, now) });
    }

    // 2. Verify. An unknown account verifies against a throw-away hash (same cost).
    const found = await this.accounts.findByEmail(email);
    const passwordOk = await this.hasher.verify(found?.passwordHash ?? null, input.password);
    let failure: LoginFailureReason | null = null;
    if (found === null) failure = 'unknown_account';
    else if (!passwordOk) failure = 'bad_password';
    else if (found.status !== 'active') failure = 'account_disabled';
    else if (!isChannelAllowed(found.role, 'web')) failure = 'channel_not_permitted';

    if (failure !== null || found === null) {
      await this.recordFailure({ reason: failure ?? 'unknown_account', accountId: found?.id ?? null, email, emailKey, ipKey, now, auditMeta });
      throw new AppError('invalid_credentials');
    }

    // 3. Success: forget the failures of this e-mail (the address counter is not reset by a success),
    // upgrade the hash if the cost parameters moved, open the session.
    await this.throttle.clear(emailKey);
    if (this.hasher.needsRehash(found.passwordHash)) {
      try {
        await this.accounts.updatePasswordHash(found.id, await this.hasher.hash(input.password));
      } catch (error) {
        this.logger.warn({ err: error, accountId: found.id }, 'password hash upgrade failed; keeping the old hash');
      }
    }

    const token = generateSessionToken();
    const sessionId = uuidv7(now.getTime());
    const expiresAt = new Date(now.getTime() + Math.min(this.config.sessionIdleMs, this.config.sessionAbsoluteMs));
    await this.sessions.create({ id: sessionId, accountId: found.id, tokenHash: hashSessionToken(token), createdAt: now, expiresAt });
    await this.audit.record({
      action: AUDIT_ACTIONS.loginSuccess,
      actorAccountId: found.id,
      detail: { ...auditMeta, sessionId },
    });
    await this.maybePurge(now);

    const user: CurrentUser = {
      accountId: found.id,
      email: found.email,
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
        email: row.email,
        displayName: row.displayName,
        role: row.role,
        sellerCodes: await this.accounts.sellerCodesOf(row.accountId),
        sessionId: row.sessionId,
        sessionExpiresAt: expiresAt,
        channel,
      },
    };
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

  /** The contract body of an authenticated session. Explicit fields only: the domain type is never serialized. */
  toSessionBody(user: CurrentUser): AuthenticatedSession {
    return {
      authenticated: true,
      authMode: this.config.authMode,
      account: {
        id: user.accountId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        sellerCodes: [...user.sellerCodes],
      },
      expiresAt: user.sessionExpiresAt.toISOString(),
    };
  }

  private async recordFailure(input: {
    reason: LoginFailureReason;
    accountId: string | null;
    email: string;
    emailKey: string;
    ipKey: string;
    now: Date;
    auditMeta: { ip: string; userAgent: string | null; requestId: string };
  }): Promise<void> {
    const account = await this.throttle.recordFailure(input.emailKey, input.now, this.config.throttle.account);
    const ip = await this.throttle.recordFailure(input.ipKey, input.now, this.config.throttle.ip);

    await this.audit.record({
      action: AUDIT_ACTIONS.loginFailure,
      actorAccountId: input.accountId,
      detail: {
        ...input.auditMeta,
        reason: input.reason,
        // Attacker-chosen text is never stored: a short fingerprint lets an investigator correlate.
        ...(input.accountId === null ? { emailFingerprint: emailFingerprint(input.email) } : {}),
      },
    });
    if (account.lockedNow) {
      await this.audit.record({
        action: AUDIT_ACTIONS.lockout,
        actorAccountId: input.accountId,
        detail: {
          scope: 'account',
          lockoutCount: account.state.lockoutCount,
          lockedUntil: account.state.lockedUntil?.toISOString() ?? null,
          ip: input.auditMeta.ip,
          emailFingerprint: emailFingerprint(input.email),
        },
      });
    }
    if (ip.lockedNow) {
      await this.audit.record({
        action: AUDIT_ACTIONS.lockout,
        actorAccountId: null,
        detail: { scope: 'ip', ip: input.auditMeta.ip, lockedUntil: ip.state.lockedUntil?.toISOString() ?? null },
      });
    }
    await this.maybePurge(input.now);
  }

  /** Keeps `auth_throttle` and `session` bounded without a scheduler: at most once per interval per process. */
  private async maybePurge(now: Date): Promise<void> {
    if (now.getTime() - this.#lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.#lastPurgeAt = now.getTime();
    try {
      await this.throttle.purgeStale(now);
      await this.sessions.purge(now);
    } catch (error) {
      this.logger.warn({ err: error }, 'auth housekeeping failed');
    }
  }
}
