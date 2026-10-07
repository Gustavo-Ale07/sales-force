import { Inject, Injectable } from '@nestjs/common';
import { account, accountSellerLink, type Database, type AccountRole, type AccountStatus } from '@salesforce/db';
import { normalizeUsername } from '@salesforce/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';

/**
 * NAMING DEBT: the physical column is still `account.email` (unique index on `lower(email)`) although it holds the
 * login identifier, not an e-mail address. It is mapped to `username` right here; nothing outside this file knows the
 * column name. Renaming it is a future expand -> migrate -> contract change (docs/implementation/auth-username-flow.md).
 */
export interface AccountRecord {
  readonly id: string;
  /** Login identifier (user name). Stored in the legacy `email` column. */
  readonly username: string;
  /** Stable id of the ERP directory user this account is linked to; null for local accounts. Linked accounts never hold a local password. */
  readonly externalUserId: string | null;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
}

export interface NewAccount {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: AccountRole;
  readonly createdAt: Date;
}

type Writer = Pick<Database, 'insert' | 'update' | 'delete' | 'select'>;

/** Storage of `account` and `account_seller_link`. Owned by the identity module. */
@Injectable()
export class AccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Case-insensitive match on the login identifier (the unique index is on `lower(email)`, the legacy column). */
  async findByUsername(username: string): Promise<AccountRecord | null> {
    const [row] = await this.db
      .select()
      .from(account)
      .where(sql`lower(${account.email}) = ${normalizeUsername(username).toLowerCase()}`);
    return row === undefined ? null : toRecord(row);
  }

  async findById(id: string): Promise<AccountRecord | null> {
    const [row] = await this.db.select().from(account).where(eq(account.id, id));
    return row === undefined ? null : toRecord(row);
  }

  async sellerCodesOf(accountId: string): Promise<number[]> {
    const rows = await this.db
      .select({ sellerCode: accountSellerLink.sellerCode })
      .from(accountSellerLink)
      .where(eq(accountSellerLink.accountId, accountId));
    return rows.map((row) => row.sellerCode);
  }

  /** Returns false when the login identifier is already registered (case-insensitively). */
  async insert(values: NewAccount, writer: Writer = this.db): Promise<boolean> {
    const inserted = await writer
      .insert(account)
      .values({
        id: values.id,
        email: values.username, // legacy column name
        displayName: values.displayName,
        passwordHash: values.passwordHash,
        role: values.role,
        status: 'active',
        createdAt: values.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: account.id });
    return inserted.length > 0;
  }

  /**
   * Replaces the local password hash. Returns false (and writes nothing) when the account does not exist or is linked
   * to an external directory user: those never have a local password, and the guard is in the statement itself so no
   * concurrent link can be overtaken.
   */
  async updatePasswordHash(id: string, passwordHash: string, writer: Writer = this.db): Promise<boolean> {
    const updated = await writer
      .update(account)
      .set({ passwordHash })
      .where(and(eq(account.id, id), isNull(account.externalUserId)))
      .returning({ id: account.id });
    return updated.length > 0;
  }

  async updateStatus(id: string, status: AccountStatus, writer: Writer = this.db): Promise<void> {
    await writer.update(account).set({ status }).where(eq(account.id, id));
  }

  /**
   * Replaces the account's seller link with the one the installation configuration names (CFG-2).
   * The schema holds one seller per account; a configuration naming several for one account is
   * rejected by the caller, not resolved here.
   */
  async upsertSellerLink(
    link: { accountId: string; sellerCode: number; configVersionId: string },
    writer: Writer = this.db,
  ): Promise<void> {
    await writer
      .insert(accountSellerLink)
      .values({ ...link, source: 'manual' })
      .onConflictDoUpdate({
        target: accountSellerLink.accountId,
        // Configuration/administration is authoritative: an overridden automatic link becomes manual and the ERP sync stops managing it.
        set: { sellerCode: link.sellerCode, configVersionId: link.configVersionId, source: 'manual' },
      });
  }
}

function toRecord(row: typeof account.$inferSelect): AccountRecord {
  return {
    id: row.id,
    username: row.email, // legacy column name
    externalUserId: row.externalUserId,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    role: row.role as AccountRole,
    status: row.status as AccountStatus,
  };
}
