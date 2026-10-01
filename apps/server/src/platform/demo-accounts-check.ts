import { account, type Database } from '@salesforce/db';
import { sql } from 'drizzle-orm';

const DEMO_DOMAIN = 'demo.salesforce.local';

/** Demo/seed accounts live on `demo.salesforce.local` (or a subdomain of it); matching is case-insensitive. */
export function isDemoAccountEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain === DEMO_DOMAIN || domain.endsWith(`.${DEMO_DOMAIN}`);
}

/**
 * Startup policy (LOW-1). Production only: demo accounts found => refuse to boot (they carry a known
 * development password) unless `allowDemoAccounts` is set explicitly (`SF_ALLOW_DEMO_ACCOUNTS=true`,
 * then a warning); a failing check only warns. Outside production nothing is checked, so the dev
 * compose (NODE_ENV=development) is unaffected. Never logs or throws an e-mail address.
 */
export async function enforceDemoAccountsPolicy(
  db: Database,
  nodeEnv: string,
  allowDemoAccounts: boolean,
  logger: { warn: (fields: object, message: string) => void },
): Promise<void> {
  if (nodeEnv !== 'production') return;
  const demo = await demoAccountsWarning(db, nodeEnv);
  if (demo === null) {
    logger.warn({}, 'could not check the production database for demo accounts (*.demo.salesforce.local); verify manually');
    return;
  }
  if (demo.count === 0) return;
  if (!allowDemoAccounts) {
    throw new Error(
      `refusing to start: production database contains ${demo.count} demo account(s) (*.demo.salesforce.local) with a known development password; remove them, or set SF_ALLOW_DEMO_ACCOUNTS=true to override explicitly`,
    );
  }
  logger.warn({ demoAccounts: demo.count }, 'production database contains demo accounts (*.demo.salesforce.local), allowed explicitly by SF_ALLOW_DEMO_ACCOUNTS');
}

/**
 * F12: in production, how many demo accounts exist (they carry a known development password).
 * A startup warning only: it never blocks the process, never returns or logs an e-mail address,
 * and a failing query yields `null`. Outside production there is nothing to check.
 */
export async function demoAccountsWarning(db: Database, nodeEnv: string): Promise<{ count: number } | null> {
  if (nodeEnv !== 'production') return null;
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(account)
      .where(sql`lower(${account.email}) like '%@demo.salesforce.local' or lower(${account.email}) like '%.demo.salesforce.local'`);
    return { count: row?.count ?? 0 };
  } catch {
    return null;
  }
}
