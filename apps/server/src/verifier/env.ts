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
 * The verifier reads no Sankhya setting and no database setting: the live adapter does not exist, so
 * `VERIFIER_MODE=live` is refused as "not implemented" and the presence of any Sankhya or database
 * variable in this process is itself a boot error (least privilege: a mis-wired secret file is caught
 * instead of silently held).
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
  VERIFIER_THROTTLE_WINDOW_MS: integerField({ min: 1000, max: 3_600_000 }, 60_000),
  VERIFIER_MAX_CONCURRENCY: integerField({ min: 1, max: 64 }, 4),
});

export interface VerifierConfig {
  readonly nodeEnv: z.infer<typeof nodeEnvField>;
  readonly logLevel: z.infer<typeof logLevelField>;
  readonly mode: 'disabled';
  readonly host: string;
  readonly port: number;
  readonly sharedSecret: Secret;
  readonly bodyLimitBytes: number;
  readonly timeoutMs: number;
  readonly throttleMax: number;
  readonly throttleWindowMs: number;
  readonly maxConcurrency: number;
}

/** Variable name prefixes this process must never be given (compared case-insensitively, key only). */
const FORBIDDEN_PREFIXES = ['sankhya', 'database_url', 'db_', 'pg', 'session_', 'smtp_', 'sentry_'];

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
      `${forbidden.sort().join(', ')}: not accepted by the verifier (it holds no ERP, database or session settings; the ERP adapter is not implemented).`,
    ]);
  }

  const env = parseEnv('verifier', verifierEnvSchema, source, (parsed) => {
    const problems: string[] = [];
    if (parsed.VERIFIER_MODE === 'live') {
      problems.push('VERIFIER_MODE: "live" is not implemented (the ERP adapter is blocked); use "disabled".');
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

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    mode: 'disabled',
    host: env.VERIFIER_HOST,
    port: env.VERIFIER_PORT,
    sharedSecret: new Secret(rawSecret),
    bodyLimitBytes: env.VERIFIER_BODY_LIMIT_BYTES,
    timeoutMs: env.VERIFIER_TIMEOUT_MS,
    throttleMax: env.VERIFIER_THROTTLE_MAX,
    throttleWindowMs: env.VERIFIER_THROTTLE_WINDOW_MS,
    maxConcurrency: env.VERIFIER_MAX_CONCURRENCY,
  };
}
