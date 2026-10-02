import { account, type Database } from '@salesforce/db';
import { sql } from 'drizzle-orm';
import { errorLogFields } from '../observability/logger.js';

const DEMO_DOMAIN = 'demo.salesforce.local';

/** Demo/seed accounts live on `demo.salesforce.local` (or a subdomain of it); matching is case-insensitive. */
export function isDemoAccountEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain === DEMO_DOMAIN || domain.endsWith(`.${DEMO_DOMAIN}`);
}

/**
 * Startup policy (LOW-1), fail closed. Production only: the check must positively establish that no demo
 * account exists. Demo accounts found => refuse to boot (known development password); the check itself
 * failing => refuse to boot too, with a generic error (driver/DB details go to the internal log only).
 * `allowDemoAccounts` (`SF_ALLOW_DEMO_ACCOUNTS=true`) is the explicit, warned override for both cases.
 * Outside production nothing is checked, so the dev compose (NODE_ENV=development) is unaffected.
 * Never logs or throws an e-mail address.
 */
export async function enforceDemoAccountsPolicy(
  db: Database,
  nodeEnv: string,
  allowDemoAccounts: boolean,
  logger: { warn: (fields: object, message: string) => void; error: (fields: object, message: string) => void },
): Promise<void> {
  if (nodeEnv !== 'production') return;
  let count: number | null = null;
  try {
    count = await countDemoAccounts(db);
  } catch (error) {
    // Details stay in the internal log; the thrown error deliberately carries no cause.
    logger.error({ ...errorLogFields(error) }, 'demo accounts check failed in production');
  }
  if (count === null) {
    if (!allowDemoAccounts) {
      throw new Error(
        'refusing to start: could not verify that the production database has no demo accounts; fix the database connection and restart, or set SF_ALLOW_DEMO_ACCOUNTS=true to override explicitly',
      );
    }
    logger.warn({}, 'demo accounts check failed; starting anyway because SF_ALLOW_DEMO_ACCOUNTS=true (demo accounts NOT verified absent)');
    return;
  }
  if (count === 0) return;
  if (!allowDemoAccounts) {
    throw new Error(
      `refusing to start: production database contains ${count} demo account(s) (*.demo.salesforce.local) with a known development password; remove them, or set SF_ALLOW_DEMO_ACCOUNTS=true to override explicitly`,
    );
  }
  logger.warn({ demoAccounts: count }, 'production database contains demo accounts (*.demo.salesforce.local), allowed explicitly by SF_ALLOW_DEMO_ACCOUNTS');
}

async function countDemoAccounts(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(account)
    .where(sql`lower(${account.email}) like '%@demo.salesforce.local' or lower(${account.email}) like '%.demo.salesforce.local'`);
  return row?.count ?? 0;
}

/**
 * F12: in production, how many demo accounts exist (they carry a known development password).
 * Never returns or logs an e-mail address; a failing query yields `null` (callers that must fail
 * closed use `enforceDemoAccountsPolicy`). Outside production there is nothing to check.
 */
export async function demoAccountsWarning(db: Database, nodeEnv: string): Promise<{ count: number } | null> {
  if (nodeEnv !== 'production') return null;
  try {
    return { count: await countDemoAccounts(db) };
  } catch {
    return null;
  }
}
