import { z } from 'zod';
import { passwordHashFields } from './auth-env.js';
import { databaseUrlField, isLoopbackDatabaseUrl, nodeEnvField, parseEnv, type EnvSource } from './env.js';
import { checkPasswordPolicy } from '../iam/password-policy.js';

/**
 * Environment of the development seed (`pnpm db:seed`). Every guard is checked together and reported by
 * variable name: `NODE_ENV` is set (no default) and is not `production`; the database host is loopback;
 * `SEED_DEV_PASSWORD` is set (no fallback value exists) and satisfies the password policy. A production
 * (or staging) deployment therefore never depends on, nor can run, the seed.
 */
export const SeedEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  SF_CONFIG_FILE: z.string().min(1).optional(),
  SEED_DEV_PASSWORD: z.string({ error: 'is required: there is no default seed password (set it in your .env).' }),
  ...passwordHashFields,
});

export function parseSeedEnv(source: EnvSource) {
  return parseEnv('seed', SeedEnvSchema, source, (parsed) => {
    const problems: string[] = [];
    if (parsed.NODE_ENV === 'production') {
      problems.push('NODE_ENV: the development seed refuses to run when NODE_ENV=production.');
    }
    if (!isLoopbackDatabaseUrl(parsed.DATABASE_URL.reveal())) {
      problems.push('DATABASE_URL: the development seed only runs against a loopback database (localhost, 127.x.x.x, ::1).');
    }
    const violations = checkPasswordPolicy(parsed.SEED_DEV_PASSWORD);
    if (violations.length > 0) {
      problems.push(`SEED_DEV_PASSWORD: does not satisfy the password policy (${violations.join(', ')}).`);
    }
    return problems;
  });
}
