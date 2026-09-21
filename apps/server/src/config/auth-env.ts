import { integerField, type NodeEnvironment } from './env.js';

/**
 * Argon2id cost parameters (P-11). Defaults follow the OWASP Password Storage Cheat Sheet minimum
 * (19 MiB memory, 2 iterations, 1 lane). They are configurable so the cost can be raised as
 * hardware allows; below the OWASP floor is refused when `NODE_ENV=production` (tests and local
 * development may lower them to keep suites fast).
 */
export const OWASP_ARGON2ID_MIN = { memoryKib: 19_456, timeCost: 2, parallelism: 1 } as const;

export const passwordHashFields = {
  PASSWORD_HASH_MEMORY_KIB: integerField({ min: 8, max: 1_048_576 }, OWASP_ARGON2ID_MIN.memoryKib),
  PASSWORD_HASH_TIME_COST: integerField({ min: 1, max: 20 }, OWASP_ARGON2ID_MIN.timeCost),
  PASSWORD_HASH_PARALLELISM: integerField({ min: 1, max: 16 }, OWASP_ARGON2ID_MIN.parallelism),
};

export interface PasswordHashEnv {
  readonly PASSWORD_HASH_MEMORY_KIB: number;
  readonly PASSWORD_HASH_TIME_COST: number;
  readonly PASSWORD_HASH_PARALLELISM: number;
}

export interface PasswordHashParams {
  readonly memoryKib: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

export function passwordHashParamsOf(env: PasswordHashEnv): PasswordHashParams {
  return {
    memoryKib: env.PASSWORD_HASH_MEMORY_KIB,
    timeCost: env.PASSWORD_HASH_TIME_COST,
    parallelism: env.PASSWORD_HASH_PARALLELISM,
  };
}

/** Problems (variable names only) when the cost is below the OWASP floor in production. */
export function passwordHashProblems(env: PasswordHashEnv & { readonly NODE_ENV: NodeEnvironment }): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (env.PASSWORD_HASH_MEMORY_KIB < OWASP_ARGON2ID_MIN.memoryKib) {
    problems.push(
      `PASSWORD_HASH_MEMORY_KIB: must be at least ${OWASP_ARGON2ID_MIN.memoryKib} when NODE_ENV=production.`,
    );
  }
  if (env.PASSWORD_HASH_TIME_COST < OWASP_ARGON2ID_MIN.timeCost) {
    problems.push(`PASSWORD_HASH_TIME_COST: must be at least ${OWASP_ARGON2ID_MIN.timeCost} when NODE_ENV=production.`);
  }
  return problems;
}
