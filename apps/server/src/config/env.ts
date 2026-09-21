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

export const nodeEnvField = z
  .enum(NODE_ENVIRONMENTS, { error: `must be one of: ${NODE_ENVIRONMENTS.join(', ')}.` })
  .default('development');

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
