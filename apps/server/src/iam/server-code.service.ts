import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { encodeServerCode, isServerCodeSecret } from '@salesforce/contracts';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import { ServerCodeRepository } from './server-code.repository.js';
import { SessionRepository } from './session.repository.js';
import { ThrottleRepository } from './throttle.repository.js';

/** Failed code checks tolerated per client address inside the window before the address gets 429. */
export const SERVER_CODE_MAX_FAILURES = 20;
export const SERVER_CODE_FAILURE_WINDOW_MS = 10 * 60 * 1000;

const FAILURE_KEY_PREFIX = 'server_code:ip:';

export function hashServerCodeSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Server code (owner ruling 2026-11-27): generation/rotation and the constant-time check behind the global guard. Only the SHA-256 of
 * the secret `k` is stored; the whole code is returned once by `rotate` and never logged.
 */
@Injectable()
export class ServerCodeService {
  constructor(
    @Inject(ServerCodeRepository) private readonly codes: ServerCodeRepository,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ThrottleRepository) private readonly throttle: ThrottleRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** True only when `secret` is well formed and hashes to the active code. No code configured = false (fail closed). */
  async verify(secret: string | undefined): Promise<boolean> {
    if (secret === undefined || !isServerCodeSecret(secret)) return false;
    const stored = await this.codes.activeHash();
    if (stored === null || !/^[0-9a-f]{64}$/.test(stored)) return false;
    const presented = Buffer.from(hashServerCodeSecret(secret), 'hex');
    return timingSafeEqual(presented, Buffer.from(stored, 'hex'));
  }

  private failureKey(address: string): string {
    return `${FAILURE_KEY_PREFIX}${address}`;
  }

  /** True when the address already failed `SERVER_CODE_MAX_FAILURES` times inside the current window. */
  async isBlocked(address: string): Promise<boolean> {
    const state = await this.throttle.find(this.failureKey(address));
    if (state === null) return false;
    const fresh = this.clock().getTime() - state.windowStartedAt.getTime() < SERVER_CODE_FAILURE_WINDOW_MS;
    return fresh && state.failures >= SERVER_CODE_MAX_FAILURES;
  }

  async recordFailure(address: string): Promise<void> {
    await this.throttle.bumpWindow(this.failureKey(address), this.clock(), SERVER_CODE_FAILURE_WINDOW_MS);
  }

  /** Operator view: whether a code is active, a short hash prefix and its date. Never the code, never the full hash. */
  async describeActive(): Promise<{ hashPrefix: string; createdAt: Date } | null> {
    const row = await this.codes.activeSummary();
    return row === null ? null : { hashPrefix: row.codeHash.slice(0, 8), createdAt: row.createdAt };
  }

  /**
   * Generates a new secret, replaces the stored hash, revokes EVERY session and audits (actor 'cli', without the value), all in one
   * transaction. Returns the complete code, to be shown exactly once. Only the operator CLI calls this: no HTTP route does.
   */
  async rotate(publicApiUrl: string): Promise<{ code: string; revokedSessions: number }> {
    const secret = randomBytes(32).toString('base64url');
    const code = encodeServerCode({ a: publicApiUrl, k: secret });
    const now = this.clock();
    const revokedSessions = await this.codes.transaction(async (tx) => {
      await this.codes.replace(tx, {
        id: uuidv7(now.getTime()),
        codeHash: hashServerCodeSecret(secret),
        createdAt: now,
        rotatedByAccountId: null,
      });
      const revoked = await this.sessions.revokeAll(now, tx);
      await this.audit.record({ action: AUDIT_ACTIONS.serverCodeRotated, actorAccountId: null, detail: { actor: 'cli', revokedSessions: revoked } }, tx);
      return revoked;
    });
    // A new code starts with clean failure counters (addresses blocked by the old one are released).
    await this.throttle.clearPrefix(FAILURE_KEY_PREFIX);
    return { code, revokedSessions };
  }
}
