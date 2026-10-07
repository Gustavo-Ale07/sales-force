import type { AuthMode } from '@salesforce/contracts';
import type { AccountRole } from '@salesforce/domain';
import type { ParsedApiEnv } from '../config/api-env.js';
import { passwordHashParamsOf, type PasswordHashParams } from '../config/auth-env.js';
import { CredentialSecret, type SecretValue } from './external-identity.js';
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
  /**
   * Roles that may hold a session ONLY when the account is linked to a directory (Sankhya) user and signed in through the
   * external login, in addition to `allowedRoles`. They never authenticate with a local password. Only set together with
   * the external login (`withExternalSellerLogin`); ignored when `allowedRoles` is undefined (every role is admitted).
   */
  readonly externalOnlyRoles?: readonly AccountRole[];
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
   * External (ERP directory) login. UNDEFINED unless the installation sets `EXTERNAL_LOGIN_ENABLED=1` (with the
   * internal verifier URL and shared secret): `authConfigFromEnv` then enables it for the `seller` profile only
   * (AUTH-5, STACK-2a); the admin/technical local login is unchanged.
   */
  readonly externalLogin?: ExternalLoginConfig;
}

/**
 * How a verified directory user gets a Force account.
 * - `PRE_LINKED` (DEFAULT, also when omitted): only an account already carrying that user's `external_user_id` (set by an
 *   administrator) can sign in; a login never creates an account or a link. No directory user is trusted to self-register.
 * - `VERIFIED_AUTO_PROVISION`: first sign-in of a verified, active directory user whose OFFICIAL ERP record ties it to one active,
 *   unclaimed seller creates a restricted `seller` account and link (see `ExternalAccountLinks.syncFromDirectory`); later logins
 *   reconcile it. Reached only by `EXTERNAL_AUTO_PROVISION=1` (default `0`) or explicit test configuration.
 */
export type ExternalLinkMode = 'PRE_LINKED' | 'VERIFIED_AUTO_PROVISION';

export interface ExternalLoginConfig {
  readonly enabled: boolean;
  /** Account linking policy; `PRE_LINKED` when omitted. */
  readonly linkMode?: ExternalLinkMode;
  /** Oldest mirror of the ERP user -> seller relation an automatic link is accepted on; older = refused (default 2 h). */
  readonly directoryMaxAgeMs?: number;
  /** Upper bound of one verification (the caller's signal can only shorten it). */
  readonly verifyTimeoutMs: number;
  /** Failed external logins answer no sooner than this, so timing does not tell the failure causes apart. */
  readonly minFailureMs: number;
  /** Internal verifier process (STACK-2a): base URL on the internal network and the shared Bearer secret. */
  readonly verifier?: { readonly url: string; readonly sharedSecret: SecretValue };
}

/**
 * Turns the directory login on for the `seller` profile (link mode `PRE_LINKED` unless `externalLogin.linkMode` says otherwise): `local` mode admits only admin/technical, so the seller role
 * is added explicitly and only here. `manager` is admitted only as an external-only role: an account explicitly linked to a
 * directory user may hold a session after the external login, a local manager never signs in with a password (it stays refused).
 * Every other role stays refused until an owner decision (AUTH-5 extension, docs/implementation/auth-username-flow.md). Never called by `authConfigFromEnv`: off by default.
 */
export function withExternalSellerLogin(config: AuthConfig, externalLogin: ExternalLoginConfig): AuthConfig {
  return {
    ...config,
    externalLogin: { ...externalLogin, linkMode: externalLogin.linkMode ?? 'PRE_LINKED' },
    ...(config.allowedRoles === undefined
      ? {}
      : { allowedRoles: [...config.allowedRoles, 'seller' as const], externalOnlyRoles: [...(config.externalOnlyRoles ?? []), 'manager' as const] }),
  };
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

/** Seller login with the user's Sankhya credentials, only when the installation switched it on (EXTERNAL_LOGIN_ENABLED=1). */
const EXTERNAL_VERIFY_TIMEOUT_MS = 10_000;
const EXTERNAL_MIN_FAILURE_MS = 400;

export function authConfigFromEnv(env: ParsedApiEnv): AuthConfig {
  const base = baseAuthConfig(env);
  if (env.externalVerifier === null) return base;
  return withExternalSellerLogin(base, {
    enabled: true,
    ...(env.EXTERNAL_AUTO_PROVISION === '1' ? { linkMode: 'VERIFIED_AUTO_PROVISION' as const } : {}),
    directoryMaxAgeMs: env.EXTERNAL_DIRECTORY_MAX_AGE_MINUTES * MINUTE_MS,
    verifyTimeoutMs: EXTERNAL_VERIFY_TIMEOUT_MS,
    minFailureMs: EXTERNAL_MIN_FAILURE_MS,
    verifier: { url: env.externalVerifier.url, sharedSecret: new CredentialSecret(env.externalVerifier.sharedSecret) },
  });
}

function baseAuthConfig(env: ParsedApiEnv): AuthConfig {
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
