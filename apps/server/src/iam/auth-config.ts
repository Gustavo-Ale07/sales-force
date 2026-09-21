import type { ParsedApiEnv } from '../config/api-env.js';
import { passwordHashParamsOf, type PasswordHashParams } from '../config/auth-env.js';
import type { ThrottleRule } from './throttle-policy.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Everything the identity module needs to know about its environment, resolved once at start-up.
 * Modules never read `process.env` (see `InfrastructureModule`).
 */
export interface AuthConfig {
  /** `dev` is the only mode that exists (contracts `AuthMode`). Never production. */
  readonly authMode: 'dev';
  /** `Secure` cookie attribute: required everywhere except local development. */
  readonly secureCookies: boolean;
  /** Origins allowed to send state-changing requests (CSRF Origin check). */
  readonly allowedOrigins: readonly string[];
  /** Idle expiry, slid by activity. */
  readonly sessionIdleMs: number;
  /** Absolute lifetime cap. */
  readonly sessionAbsoluteMs: number;
  /** `last_seen_at` / expiry are rewritten at most this often (limits write load per request). */
  readonly sessionTouchIntervalMs: number;
  readonly passwordHash: PasswordHashParams;
  readonly throttle: {
    /** Progressive lockout per e-mail (RF-IAM-2: 5 failures, 15 minutes, escalating). */
    readonly account: ThrottleRule;
    /** Failure rate limit per client address. */
    readonly ip: ThrottleRule;
  };
  /** Denial-of-service limits of the login endpoint (independent of the per-key lockouts above). */
  readonly login: LoginLimits;
}

export interface LoginLimits {
  /** Argon2id hashes in flight at once; a login that finds none free answers 429. */
  readonly maxConcurrentHashes: number;
  /** Failed password checks per minute the whole installation tolerates; beyond it logins answer 429. */
  readonly globalMaxFailuresPerMinute: number;
  /** Window of the audit sampling of blocked / throttled attempts. */
  readonly blockedAuditWindowMs: number;
}

/** RF-IAM-2: 5 failures lock for 15 minutes; repeated lockouts double the duration (cap 24 h). */
export const DEFAULT_ACCOUNT_THROTTLE: ThrottleRule = {
  maxFailures: 5,
  windowMs: 15 * MINUTE_MS,
  baseLockMs: 15 * MINUTE_MS,
  maxLockMs: 24 * HOUR_MS,
};

/** Assumption (not in the spec): 20 failed attempts per 15 minutes from one address, then 15 minutes blocked. */
export const DEFAULT_IP_THROTTLE: ThrottleRule = {
  maxFailures: 20,
  windowMs: 15 * MINUTE_MS,
  baseLockMs: 15 * MINUTE_MS,
  maxLockMs: 15 * MINUTE_MS,
};

export function authConfigFromEnv(env: ParsedApiEnv): AuthConfig {
  return {
    authMode: 'dev',
    secureCookies: env.NODE_ENV !== 'development',
    allowedOrigins: env.allowedOrigins,
    sessionIdleMs: env.SESSION_IDLE_TIMEOUT_MINUTES * MINUTE_MS,
    sessionAbsoluteMs: env.SESSION_ABSOLUTE_TIMEOUT_HOURS * HOUR_MS,
    sessionTouchIntervalMs: MINUTE_MS,
    passwordHash: passwordHashParamsOf(env),
    throttle: { account: DEFAULT_ACCOUNT_THROTTLE, ip: DEFAULT_IP_THROTTLE },
    login: {
      maxConcurrentHashes: env.LOGIN_MAX_CONCURRENT_HASHES,
      globalMaxFailuresPerMinute: env.LOGIN_GLOBAL_MAX_PER_MINUTE,
      blockedAuditWindowMs: MINUTE_MS,
    },
  };
}
