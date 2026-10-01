import { z } from 'zod';
import { DATASET_ID_SLUG_PATTERN, ENVIRONMENT_SLUG_PATTERN, type DatasetIdentity } from '@salesforce/contracts';
import { passwordHashFields, passwordHashProblems } from './auth-env.js';
import {
  databaseUrlField,
  integerField,
  logLevelField,
  nodeEnvField,
  parseEnv,
  portField,
  trustProxyField,
  type EnvSource,
} from './env.js';

/**
 * API process environment (STACK-2/STACK-3). The API never reads `SANKHYA_*` or any other Sankhya
 * setting: unknown variables are ignored, so a stray credential in the API environment is never
 * even parsed. Everything the API needs to say about the integration comes from the database.
 */
export const ApiEnvSchema = z.object({
  // Required, no default: a missing NODE_ENV must never silently select development guards.
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  LOG_LEVEL: logLevelField,
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: portField(3000),
  DB_POOL_MAX: integerField({ min: 1, max: 100 }, 10),
  /** How long a request waits for a free pooled connection before failing (bounded, never forever). */
  DB_CONNECTION_TIMEOUT_MS: integerField({ min: 100, max: 60_000 }, 5000),
  /** Server-side `statement_timeout` of every pooled connection: a slow query is cancelled by PostgreSQL. */
  DB_STATEMENT_TIMEOUT_MS: integerField({ min: 100, max: 600_000 }, 15_000),
  /** `/ready` results are reused this long (ms; 0 = no cache): the endpoint is public, its cost must be bounded. */
  READINESS_CACHE_TTL_MS: integerField({ min: 0, max: 60_000 }, 3000),
  /** Argon2id hashes running at once (they block the event loop); beyond it a login answers 429. */
  LOGIN_MAX_CONCURRENT_HASHES: integerField({ min: 1, max: 64 }, 4),
  /** Failed password checks per minute the whole installation tolerates, every client together (login DoS budget). */
  LOGIN_GLOBAL_MAX_PER_MINUTE: integerField({ min: 10, max: 100_000 }, 300),

  // Authentication. Only `dev` exists today and it needs an explicit opt-in (ALLOW_DEV_AUTH=1) on
  // top of a non-production NODE_ENV (both checked below).
  AUTH_MODE: z.enum(['dev'], { error: "must be 'dev' (the only mode that exists today)." }).default('dev'),
  ALLOW_DEV_AUTH: z.string().optional(),
  /** Idle expiry of a session; every request within the window slides it (security model §3.2: 12 h). */
  SESSION_IDLE_TIMEOUT_MINUTES: integerField({ min: 5, max: 10_080 }, 720),
  /** Hard cap on a session's lifetime, however active (documented default: 7 days). */
  SESSION_ABSOLUTE_TIMEOUT_HOURS: integerField({ min: 1, max: 720 }, 168),
  /** Comma-separated origins allowed to send state-changing requests (CSRF Origin check). */
  ALLOWED_ORIGINS: z.string().optional(),
  ...passwordHashFields,

  /**
   * Explicit installation dataset identity (DEV-phase working mechanism, not a secret). Both or none
   * (checked below). Never derived from any SANKHYA_* setting: the API does not read those.
   */
  SF_ERP_ENVIRONMENT: z
    .string()
    .regex(ENVIRONMENT_SLUG_PATTERN, { error: 'must be a slug: lowercase letters, digits, - or _ (max 32), e.g. sandbox.' })
    .optional(),
  SF_DATASET_ID: z
    .string()
    .regex(DATASET_ID_SLUG_PATTERN, { error: 'must be a slug of 3-64 characters: lowercase letters, digits, . - or _, e.g. acme-sandbox-real-1.' })
    .optional(),

  // HTTP server hardening.
  /**
   * Reverse-proxy hops or proxy CIDRs trusted for X-Forwarded-For (default outside production: none).
   * REQUIRED when NODE_ENV=production (checked below): `0` states "no proxy in front" on purpose.
   */
  TRUST_PROXY: trustProxyField,
  REQUEST_TIMEOUT_MS: integerField({ min: 1000, max: 600_000 }, 30_000),
  KEEP_ALIVE_TIMEOUT_MS: integerField({ min: 1000, max: 600_000 }, 65_000),
  CONNECTION_TIMEOUT_MS: integerField({ min: 1000, max: 3_600_000 }, 120_000),
});

export type ApiEnv = z.output<typeof ApiEnvSchema>;

/** Origins accepted in development and tests when `ALLOWED_ORIGINS` is not set (Vite dev and preview). */
export const DEVELOPMENT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
] as const;

function originProblems(raw: string | undefined, nodeEnv: string): { origins: string[]; problems: string[] } {
  if (raw === undefined) {
    return nodeEnv === 'production'
      ? { origins: [], problems: ['ALLOWED_ORIGINS: is required when NODE_ENV=production (comma-separated origins).'] }
      : { origins: [...DEVELOPMENT_ALLOWED_ORIGINS], problems: [] };
  }
  const origins = raw.split(',').map((entry) => entry.trim());
  const valid = origins.every((entry) => {
    try {
      const url = new URL(entry);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === entry;
    } catch {
      return false;
    }
  });
  return valid
    ? { origins, problems: [] }
    : { origins: [], problems: ['ALLOWED_ORIGINS: must be comma-separated origins such as https://app.example.com (no path, no trailing slash).'] };
}

/** The API environment plus the parsed origin allow-list (validated together, reported at once). */
export interface ParsedApiEnv extends ApiEnv {
  readonly allowedOrigins: readonly string[];
  /** `null` when the installation declares no dataset identity. */
  readonly dataset: DatasetIdentity | null;
}

export function parseApiEnv(source: EnvSource): ParsedApiEnv {
  let allowedOrigins: string[] = [];
  const env = parseEnv('API', ApiEnvSchema, source, (parsed) => {
    const problems: string[] = [];
    if (parsed.AUTH_MODE === 'dev') {
      if (parsed.NODE_ENV === 'production') {
        problems.push('AUTH_MODE: the dev mode is refused when NODE_ENV=production.');
      }
      if (parsed.ALLOW_DEV_AUTH !== '1') {
        problems.push('ALLOW_DEV_AUTH: the dev authentication mode needs the explicit opt-in ALLOW_DEV_AUTH=1.');
      }
    }
    if (parsed.NODE_ENV === 'production' && (source['TRUST_PROXY'] ?? '').trim() === '') {
      problems.push(
        'TRUST_PROXY: is required when NODE_ENV=production (proxy hop count or proxy IPs/CIDRs; 0 = no proxy in front). ' +
          'A wrong value lets clients choose their own address (rate limiting, audit) or collapses them into one.',
      );
    }
    const origins = originProblems(parsed.ALLOWED_ORIGINS, parsed.NODE_ENV);
    allowedOrigins = origins.origins;
    if (parsed.SF_ERP_ENVIRONMENT !== undefined && parsed.SF_DATASET_ID === undefined) {
      problems.push('SF_DATASET_ID: is required when SF_ERP_ENVIRONMENT is set (set both or neither).');
    }
    if (parsed.SF_DATASET_ID !== undefined && parsed.SF_ERP_ENVIRONMENT === undefined) {
      problems.push('SF_ERP_ENVIRONMENT: is required when SF_DATASET_ID is set (set both or neither).');
    }
    if (parsed.NODE_ENV === 'production') {
      // An undeclared dataset disables the expectedDataset guard (every client would pass it): never in production.
      if (parsed.SF_ERP_ENVIRONMENT === undefined) {
        problems.push('SF_ERP_ENVIRONMENT: is required when NODE_ENV=production (the installation must declare its dataset identity).');
      }
      if (parsed.SF_DATASET_ID === undefined) {
        problems.push('SF_DATASET_ID: is required when NODE_ENV=production (the installation must declare its dataset identity).');
      }
    }
    problems.push(...origins.problems,...passwordHashProblems(parsed));
    return problems;
  });
  const dataset =
    env.SF_ERP_ENVIRONMENT !== undefined && env.SF_DATASET_ID !== undefined
      ? { environment: env.SF_ERP_ENVIRONMENT, datasetId: env.SF_DATASET_ID }
      : null;
  return { ...env, allowedOrigins, dataset };
}
