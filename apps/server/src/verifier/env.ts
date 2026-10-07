import { readFileSync } from 'node:fs';
import { Secret } from '@salesforce/sankhya';
import { z } from 'zod';
import {
  EnvValidationError,
  integerField,
  logLevelField,
  nodeEnvField,
  parseEnv,
  portField,
  withoutEmptyValues,
  type EnvSource,
} from '../config/env.js';

/**
 * Environment of the internal identity verifier process (STACK-2 option C). Separate from the API and
 * Worker schemas, fail closed on boot, values never echoed.
 *
 * The verifier reads no database setting and no Sankhya integration credential (no `SANKHYA_*`, OAuth client or
 * X-Token): any such variable in this process is a boot error (least privilege). `VERIFIER_MODE=live` validates the
 * user's own login against the Sankhya SANDBOX only and needs `VERIFIER_SANKHYA_BASE_URL` (a sandbox origin, SNK-3).
 */
export const VERIFIER_MODES = ['disabled', 'live'] as const;
export type VerifierMode = (typeof VERIFIER_MODES)[number];

export const MIN_SHARED_SECRET_LENGTH = 32;

const verifierEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  LOG_LEVEL: logLevelField,
  VERIFIER_MODE: z.enum(VERIFIER_MODES, { error: `must be one of: ${VERIFIER_MODES.join(', ')}.` }).default('disabled'),
  VERIFIER_HOST: z.string().min(1).default('127.0.0.1'),
  VERIFIER_PORT: portField(3002),
  VERIFIER_SHARED_SECRET: z.string().optional(),
  VERIFIER_SHARED_SECRET_FILE: z.string().min(1).optional(),
  VERIFIER_BODY_LIMIT_BYTES: integerField({ min: 256, max: 16_384 }, 2048),
  VERIFIER_TIMEOUT_MS: integerField({ min: 100, max: 30_000 }, 5000),
  VERIFIER_THROTTLE_MAX: integerField({ min: 1, max: 10_000 }, 30),
  VERIFIER_PREAUTH_THROTTLE_MAX: integerField({ min: 1, max: 100_000 }, 300),
  VERIFIER_THROTTLE_WINDOW_MS: integerField({ min: 1000, max: 3_600_000 }, 60_000),
  VERIFIER_MAX_CONCURRENCY: integerField({ min: 1, max: 64 }, 4),
  /** live only: origin of the Sankhya SANDBOX (https, no path). Never a production host (SNK-3). */
  VERIFIER_SANKHYA_BASE_URL: z.string().optional(),
});

/** SNK-3: the verifier talks only to a Sankhya SANDBOX host (`<account>-teste.sankhyacloud.com.br`). */
export const SANDBOX_HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?-teste\.sankhyacloud\.com\.br$/;

/** Checked sandbox origin or the reason it is refused (never echoes the value: it could carry a typo'd secret). */
export function sandboxOriginProblem(raw: string | undefined): { origin: string } | { problem: string } {
  if (raw === undefined || raw.trim() === '') return { problem: 'VERIFIER_SANKHYA_BASE_URL: is required when VERIFIER_MODE=live.' };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { problem: 'VERIFIER_SANKHYA_BASE_URL: is not a valid URL.' };
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.port !== '' || (url.pathname !== '/' && url.pathname !== '')) {
    return { problem: 'VERIFIER_SANKHYA_BASE_URL: must be an https origin without credentials, port, path, query or fragment.' };
  }
  const host = url.hostname.toLowerCase();
  if (!SANDBOX_HOST_PATTERN.test(host)) {
    return { problem: 'VERIFIER_SANKHYA_BASE_URL: only a Sankhya sandbox host (<account>-teste.sankhyacloud.com.br) is accepted (SNK-3).' };
  }
  return { origin: `https://${host}` };
}

export interface VerifierConfig {
  readonly nodeEnv: z.infer<typeof nodeEnvField>;
  readonly logLevel: z.infer<typeof logLevelField>;
  readonly mode: VerifierMode;
  /** Present only in live mode. */
  readonly sankhya: { readonly origin: string } | null;
  readonly host: string;
  readonly port: number;
  readonly sharedSecret: Secret;
  readonly bodyLimitBytes: number;
  readonly timeoutMs: number;
  readonly throttleMax: number;
  /** Budget per window for requests that fail authentication (separate from, and larger than, `throttleMax`). */
  readonly preAuthThrottleMax: number;
  readonly throttleWindowMs: number;
  readonly maxConcurrency: number;
}

/** Variable name prefixes this process must never be given (compared case-insensitively, key only). */
const FORBIDDEN_PREFIXES = [
  'sankhya',
  'database_url',
  'db_',
  'pg',
  'postgres',
  'session_',
  'smtp_',
  'sentry_',
  'aws_',
  'offsite',
  'erp',
];

export type SecretFileReader = (path: string) => string;

export function parseVerifierEnv(
  source: EnvSource,
  readSecretFile: SecretFileReader = (path) => readFileSync(path, 'utf8'),
): VerifierConfig {
  const present = withoutEmptyValues(source);
  const forbidden = Object.keys(present).filter((key) => {
    const lower = key.toLowerCase();
    return FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix));
  });
  if (forbidden.length > 0) {
    throw new EnvValidationError('verifier', [
      `${forbidden.sort().join(', ')}: not accepted by the verifier (it holds no ERP integration credential, database or session settings).`,
    ]);
  }

  const env = parseEnv('verifier', verifierEnvSchema, source, (parsed) => {
    const problems: string[] = [];
    if (parsed.VERIFIER_MODE === 'live') {
      const checked = sandboxOriginProblem(parsed.VERIFIER_SANKHYA_BASE_URL);
      if ('problem' in checked) problems.push(checked.problem);
    } else if (parsed.VERIFIER_SANKHYA_BASE_URL !== undefined && parsed.VERIFIER_SANKHYA_BASE_URL.trim() !== '') {
      problems.push('VERIFIER_SANKHYA_BASE_URL: only applies when VERIFIER_MODE=live.');
    }
    const hasInline = parsed.VERIFIER_SHARED_SECRET !== undefined;
    const hasFile = parsed.VERIFIER_SHARED_SECRET_FILE !== undefined;
    if (hasInline && hasFile) {
      problems.push('VERIFIER_SHARED_SECRET / VERIFIER_SHARED_SECRET_FILE: set exactly one.');
    } else if (!hasInline && !hasFile) {
      problems.push('VERIFIER_SHARED_SECRET: is required (or VERIFIER_SHARED_SECRET_FILE).');
    }
    return problems;
  });

  let rawSecret = env.VERIFIER_SHARED_SECRET;
  if (rawSecret === undefined && env.VERIFIER_SHARED_SECRET_FILE !== undefined) {
    try {
      rawSecret = readSecretFile(env.VERIFIER_SHARED_SECRET_FILE).replace(/[\r\n]+$/, '');
    } catch {
      throw new EnvValidationError('verifier', ['VERIFIER_SHARED_SECRET_FILE: the file cannot be read.']);
    }
  }
  if (rawSecret === undefined || rawSecret.length < MIN_SHARED_SECRET_LENGTH) {
    throw new EnvValidationError('verifier', [
      `VERIFIER_SHARED_SECRET: must be at least ${MIN_SHARED_SECRET_LENGTH} characters (use a random value).`,
    ]);
  }

  const sandbox = env.VERIFIER_MODE === 'live' ? sandboxOriginProblem(env.VERIFIER_SANKHYA_BASE_URL) : null;
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    mode: env.VERIFIER_MODE,
    sankhya: sandbox !== null && 'origin' in sandbox ? { origin: sandbox.origin } : null,
    host: env.VERIFIER_HOST,
    port: env.VERIFIER_PORT,
    sharedSecret: new Secret(rawSecret),
    bodyLimitBytes: env.VERIFIER_BODY_LIMIT_BYTES,
    timeoutMs: env.VERIFIER_TIMEOUT_MS,
    throttleMax: env.VERIFIER_THROTTLE_MAX,
    preAuthThrottleMax: env.VERIFIER_PREAUTH_THROTTLE_MAX,
    throttleWindowMs: env.VERIFIER_THROTTLE_WINDOW_MS,
    maxConcurrency: env.VERIFIER_MAX_CONCURRENCY,
  };
}
