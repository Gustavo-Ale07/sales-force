import { z } from 'zod';
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

  // HTTP server hardening.
  /** Reverse-proxy hops or proxy CIDRs trusted for X-Forwarded-For (default: none). */
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
    const origins = originProblems(parsed.ALLOWED_ORIGINS, parsed.NODE_ENV);
    allowedOrigins = origins.origins;
    problems.push(...origins.problems, ...passwordHashProblems(parsed));
    return problems;
  });
  return { ...env, allowedOrigins };
}
