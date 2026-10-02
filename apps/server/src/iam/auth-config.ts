import type { AuthMode } from '@salesforce/contracts';
import type { AccountRole } from '@salesforce/domain';
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
  /** `dev` never runs in production; `local` is the production-capable local login for admin and technical only (AUTH-5; contracts `AuthMode`). */
  readonly authMode: AuthMode;
  /**
   * Roles allowed to hold a session in this mode. `undefined` = every role (dev). `local` allows only
   * `admin` and `technical` (LOCAL_MODE_ROLES): other roles fail login with the uniform `invalid_credentials` and any older session of
   * theirs stops resolving. Widening it needs an owner decision (external verifier, STACK-2).
   */
  readonly allowedRoles?: readonly AccountRole[];
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
  /**
   * External (ERP directory) login. UNDEFINED everywhere today: `authConfigFromEnv` never enables it,
   * so it is refused in every real runtime, production included. Enabling needs an owner decision
   * (STACK-2 exception) and a real verifier; tests enable it explicitly.
   */
  readonly externalLogin?: ExternalLoginConfig;
}

export interface ExternalLoginConfig {
  readonly enabled: boolean;
  /** Upper bound of one verification (the caller's signal can only shorten it). */
  readonly verifyTimeoutMs: number;
  /** Failed external logins answer no sooner than this, so timing does not tell the failure causes apart. */
  readonly minFailureMs: number;
}

export interface LoginLimits {
  /** Argon2id hashes in flight at once; a login that finds none free answers 429. */
  readonly maxConcurrentHashes: number;
  /** Failed password checks per minute the whole installation tolerates; beyond it logins answer 429. */
  readonly globalMaxFailuresPerMinute: number;
  /** Window of the audit sampling of blocked / throttled attempts. */
  readonly blockedAuditWindowMs: number;
}

/**
 * Profiles that may log in with `AUTH_MODE=local` (AUTH-5, ROLE-1): `admin` and `technical`. `technical` is not an
 * `admin`: it only reads health, diagnostics, integration and sync status (see `policy.ts`).
 */
export const LOCAL_MODE_ROLES: readonly AccountRole[] = Object.freeze<AccountRole[]>(['admin', 'technical']);

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
    authMode: env.AUTH_MODE,
    ...(env.AUTH_MODE === 'local' ? { allowedRoles: LOCAL_MODE_ROLES } : {}),
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
