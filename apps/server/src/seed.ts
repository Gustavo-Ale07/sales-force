import { createDb } from '@salesforce/db';
import { normalizeEmail } from '@salesforce/domain';
import { BootstrapFileConfigurationSource, DEMO_ACCOUNTS, DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { z } from 'zod';
import { createOperatorAccountService } from './cli/operator.js';
import { passwordHashFields, passwordHashParamsOf } from './config/auth-env.js';
import { InstallationConfigurationRepository } from './configuration/configuration.repository.js';
import { validateInstallationConfiguration } from './configuration/validate.js';
import { databaseUrlField, isLoopbackDatabaseUrl, nodeEnvField, parseEnv } from './config/env.js';
import { checkPasswordPolicy } from './iam/password-policy.js';
import { runMain } from './process.js';

/**
 * Development seed (`pnpm db:seed`): installation configuration snapshot plus the demo accounts.
 * Never for a shared environment; it refuses to run unless every guard holds:
 *
 * - `NODE_ENV` is set (no default) and is not `production`;
 * - the `DATABASE_URL` host is loopback (a remote or managed database is never seeded);
 * - `SEED_DEV_PASSWORD` is set (no fallback value exists) and satisfies the password policy.
 *
 * Configuration: `SF_CONFIG_FILE` set = the bootstrap file (U-11; CFG-1's physical model is
 * PROPOSED); otherwise the synthetic demo configuration of the fake Sankhya gateway. Accounts: the
 * synthetic `DEMO_ACCOUNTS` (`*.local` addresses); existing accounts are left untouched (their
 * password is not reset). Seller links come from the stored configuration (CFG-2), never from a
 * literal or from `TSIUSU.CODVEND`.
 */
const SeedEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  SF_CONFIG_FILE: z.string().min(1).optional(),
  SEED_DEV_PASSWORD: z.string({ error: 'is required: there is no default seed password (set it in your .env).' }),
  ...passwordHashFields,
});

runMain('seed', async () => {
  const env = parseEnv('seed', SeedEnvSchema, process.env, (parsed) => {
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

  const source =
    env.SF_CONFIG_FILE === undefined
      ? undefined
      : new BootstrapFileConfigurationSource({ path: env.SF_CONFIG_FILE, validate: validateInstallationConfiguration });
  const configuration = source === undefined ? DEMO_CONFIGURATION : await source.read();

  const db = createDb(env.DATABASE_URL.reveal(), { max: 2, applicationName: 'salesforce-seed' });
  try {
    const configurations = new InstallationConfigurationRepository(db.db);
    const saved = await configurations.saveSnapshot(configuration, new Date());
    process.stdout.write(
      saved.stored
        ? `installation configuration stored (${configuration.source.kind}, ${saved.contentHash})\n`
        : `installation configuration unchanged (${saved.contentHash})\n`,
    );

    const { accounts, repository } = createOperatorAccountService(db, passwordHashParamsOf(env));
    let created = 0;
    for (const demo of DEMO_ACCOUNTS) {
      if ((await repository.findByEmail(demo.email)) !== null) continue;
      await accounts.createAccount({
        email: demo.email,
        displayName: demo.displayName,
        role: demo.role,
        password: env.SEED_DEV_PASSWORD,
      });
      created += 1;
    }
    process.stdout.write(`demo accounts: ${created} created, ${DEMO_ACCOUNTS.length - created} already present\n`);

    // Seller links named by the stored configuration (CFG-2). One seller per account in the schema.
    const current = await configurations.findCurrent();
    if (current === null) throw new Error('the configuration snapshot was not found after being stored');
    const byEmail = new Map<string, Set<number>>();
    for (const link of configuration.customers.accountSellerLinks) {
      const email = normalizeEmail(link.accountEmail);
      byEmail.set(email, (byEmail.get(email) ?? new Set()).add(link.sellerCode));
    }
    let linked = 0;
    let skipped = 0;
    for (const [email, sellerCodes] of byEmail) {
      const account = await repository.findByEmail(email);
      const [sellerCode] = [...sellerCodes];
      if (account === null || sellerCode === undefined || sellerCodes.size !== 1) {
        skipped += 1;
        continue;
      }
      await accounts.linkSeller(account.id, sellerCode, current.id);
      linked += 1;
    }
    process.stdout.write(`seller links: ${linked} applied, ${skipped} skipped (no such account, or several sellers named)\n`);
  } finally {
    await db.close();
  }
});
