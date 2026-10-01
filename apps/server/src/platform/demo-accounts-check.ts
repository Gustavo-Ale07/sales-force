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
