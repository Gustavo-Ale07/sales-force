import { Inject, Injectable } from '@nestjs/common';
import { account, accountSellerLink, type Database, type AccountRole, type AccountStatus } from '@salesforce/db';
import { normalizeEmail } from '@salesforce/domain';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';

export interface AccountRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
}

export interface NewAccount {
  readonly id: string;
  readonly email: string;
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

  async findByEmail(email: string): Promise<AccountRecord | null> {
    const [row] = await this.db
      .select()
      .from(account)
      .where(sql`lower(${account.email}) = ${normalizeEmail(email)}`);
    return row === undefined ? null : (row as AccountRecord);
  }

  async findById(id: string): Promise<AccountRecord | null> {
    const [row] = await this.db.select().from(account).where(eq(account.id, id));
    return row === undefined ? null : (row as AccountRecord);
  }

  async sellerCodesOf(accountId: string): Promise<number[]> {
    const rows = await this.db
      .select({ sellerCode: accountSellerLink.sellerCode })
      .from(accountSellerLink)
      .where(eq(accountSellerLink.accountId, accountId));
    return rows.map((row) => row.sellerCode);
  }

  /** Returns false when the e-mail is already registered (case-insensitively). */
  async insert(values: NewAccount, writer: Writer = this.db): Promise<boolean> {
    const inserted = await writer
      .insert(account)
      .values({
        id: values.id,
        email: values.email,
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

  async updatePasswordHash(id: string, passwordHash: string, writer: Writer = this.db): Promise<void> {
    await writer.update(account).set({ passwordHash }).where(eq(account.id, id));
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
      .values(link)
      .onConflictDoUpdate({
        target: accountSellerLink.accountId,
        set: { sellerCode: link.sellerCode, configVersionId: link.configVersionId },
      });
  }
}
