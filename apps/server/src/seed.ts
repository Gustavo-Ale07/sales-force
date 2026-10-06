import { createDb } from '@salesforce/db';
import { normalizeEmail } from '@salesforce/domain';
import { BootstrapFileConfigurationSource, DEMO_ACCOUNTS, DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { createOperatorAccountService } from './cli/operator.js';
import { operatorIdentity } from './cli/operator-identity.js';
import { passwordHashParamsOf } from './config/auth-env.js';
import { InstallationConfigurationRepository } from './configuration/configuration.repository.js';
import { validateInstallationConfiguration } from './configuration/validate.js';
import { parseSeedEnv } from './config/seed-env.js';
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
runMain('seed', async () => {
  const env = parseSeedEnv(process.env);

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

    const { accounts, repository } = createOperatorAccountService(db, passwordHashParamsOf(env), undefined, operatorIdentity(process.env));
    let created = 0;
    for (const demo of DEMO_ACCOUNTS) {
      if ((await repository.findByUsername(demo.email)) !== null) continue;
      await accounts.createAccount({
        username: demo.email,
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
    const byLoginName = new Map<string, Set<number>>();
    for (const link of configuration.customers.accountSellerLinks) {
      const loginName = normalizeEmail(link.accountEmail);
      byLoginName.set(loginName, (byLoginName.get(loginName) ?? new Set()).add(link.sellerCode));
    }
    let linked = 0;
    let skipped = 0;
    for (const [loginName, sellerCodes] of byLoginName) {
      const account = await repository.findByUsername(loginName);
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
