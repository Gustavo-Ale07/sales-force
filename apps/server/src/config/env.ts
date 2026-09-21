import { Secret } from '@salesforce/sankhya';
import { z } from 'zod';

/**
 * Environment validation shared by both processes. Every problem is reported at once, by variable
 * name and rule; values are never echoed (they can be credentials). See `api-env.ts` and
 * `worker-env.ts` for the per-process schemas (STACK-2/STACK-3).
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class EnvValidationError extends Error {
  readonly processName: string;
  readonly problems: readonly string[];

  constructor(processName: string, problems: readonly string[]) {
    super(
      `Invalid ${processName} configuration (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n- ${problems.join('\n- ')}\n` +
        'Set these in the process environment (see .env.example). Values are never printed.',
    );
    this.name = 'EnvValidationError';
    this.processName = processName;
    this.problems = problems;
  }
}

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/** An unset variable and an empty one are the same thing: the default applies. */
export function withoutEmptyValues(source: EnvSource): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') result[key] = value.trim();
  }
  return result;
}

/** Zod issues rendered as `VARIABLE: rule`, never with the offending value. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const name = issue.path.length > 0 ? issue.path.join('.') : 'environment';
    return `${name}: ${issue.message}`;
  });
}

export function parseEnv<S extends z.ZodType>(
  processName: string,
  schema: S,
  source: EnvSource,
  extraProblems: (parsed: z.output<S>) => string[] = () => [],
): z.output<S> {
  const result = schema.safeParse(withoutEmptyValues(source));
  if (!result.success) throw new EnvValidationError(processName, describeIssues(result.error));
  const extra = extraProblems(result.data);
  if (extra.length > 0) throw new EnvValidationError(processName, extra);
  return result.data;
}

/* ---------- field builders ---------- */

const POSTGRES_URL = /^postgres(ql)?:\/\/.+/i;

/** Connection string as a `Secret` (it carries the password): it can never leak through logging. */
export const databaseUrlField = z
  .string({ error: 'is required (PostgreSQL connection string).' })
  .refine((value) => POSTGRES_URL.test(value), {
    message: 'must be a postgres:// or postgresql:// connection string.',
  })
  .transform((value) => new Secret(value));

/**
 * No default, on purpose: a production container that lost `NODE_ENV` must fail to start instead of
 * silently running with development guards (AUTH_MODE=dev, seed). Local scripts get it from `.env`.
 */
export const nodeEnvField = z.enum(NODE_ENVIRONMENTS, {
  error: `is required and must be one of: ${NODE_ENVIRONMENTS.join(', ')}.`,
});

/** Loopback host names/addresses (IPv6 without brackets). */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || /^127(\.\d{1,3}){3}$/.test(normalized);
}

/** libpq/pg parameters that replace the target named in the authority part of the URL. */
const TARGET_OVERRIDE_PARAMETERS = new Set(['host', 'hostaddr', 'port', 'service']);

/**
 * Loopback databases only: the guard of the development seed and of the account CLI. It resolves the
 * ACTUAL target of the connection string: the host of the authority part (a single, non-empty host;
 * multi-host lists and host-less URLs are refused) AND no `host`, `hostaddr`, `port` or `service`
 * query parameter, which libpq-style clients let override the authority (a URL that says
 * `127.0.0.1` but carries `?host=db.internal` connects to db.internal).
 */
export function isLoopbackDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    for (const name of parsed.searchParams.keys()) {
      if (TARGET_OVERRIDE_PARAMETERS.has(name.toLowerCase())) return false;
    }
    if (parsed.hostname === '' || parsed.hostname.includes(',')) return false;
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * `TRUST_PROXY`: how many reverse-proxy hops (a number) or which proxy addresses/CIDRs (comma list)
 * may set `X-Forwarded-For`. Unset = trust nobody (the socket address is the client). Never `true`:
 * trusting every hop lets a client pick its own address and defeats IP rate limiting and audit.
 */
export const trustProxyField = z
  .string()
  .optional()
  .transform((value, ctx): number | string[] | false => {
    if (value === undefined) return false;
    if (/^\d+$/.test(value)) {
      const hops = Number(value);
      return hops === 0 ? false : hops;
    }
    const entries = value.split(',').map((entry) => entry.trim());
    const valid = entries.every((entry) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(entry));
    if (!valid || entries.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must be a hop count or a comma-separated list of proxy IPs/CIDRs.' });
      return z.NEVER;
    }
    return entries;
  });

export const logLevelField = z
  .enum(LOG_LEVELS, { error: `must be one of: ${LOG_LEVELS.join(', ')}.` })
  .default('info');

const PORT_MESSAGE = 'must be a port number (1-65535).';

export function portField(defaultValue: number) {
  return z.coerce
    .number({ error: PORT_MESSAGE })
    .int({ error: PORT_MESSAGE })
    .min(1, { error: PORT_MESSAGE })
    .max(65535, { error: PORT_MESSAGE })
    .default(defaultValue);
}

export function integerField(range: { min: number; max: number }, defaultValue: number) {
  const message = `must be an integer between ${range.min} and ${range.max}.`;
  return z.coerce
    .number({ error: message })
    .int({ error: message })
    .min(range.min, { error: message })
    .max(range.max, { error: message })
    .default(defaultValue);
}
