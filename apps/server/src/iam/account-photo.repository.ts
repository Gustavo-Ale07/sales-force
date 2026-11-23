import { Inject, Injectable } from '@nestjs/common';
import { accountPhoto, type Database } from '@salesforce/db';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';

export interface AccountPhotoRecord {
  readonly accountId: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly sizePx: number;
  readonly contentHash: string;
  readonly storageKey: string;
  readonly updatedAt: Date;
}

export interface AccountPhotoWrite {
  readonly accountId: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly sizePx: number;
  readonly contentHash: string;
  readonly storageKey: string;
  readonly at: Date;
}

type Writer = Pick<Database, 'insert' | 'delete' | 'select'>;

/** Storage of `account_photo` (metadata only; the bytes are in the object store). Owned by the identity module. */
@Injectable()
export class AccountPhotoRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async find(accountId: string, writer: Writer = this.db): Promise<AccountPhotoRecord | null> {
    const [row] = await writer.select().from(accountPhoto).where(eq(accountPhoto.accountId, accountId));
    return row ?? null;
  }

  /** One row per account: replaced on change. */
  async upsert(input: AccountPhotoWrite, writer: Writer = this.db): Promise<void> {
    await writer
      .insert(accountPhoto)
      .values({
        accountId: input.accountId,
        contentType: input.contentType,
        byteLength: input.byteLength,
        sizePx: input.sizePx,
        contentHash: input.contentHash,
        storageKey: input.storageKey,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoUpdate({
        target: accountPhoto.accountId,
        set: {
          contentType: input.contentType,
          byteLength: input.byteLength,
          sizePx: input.sizePx,
          contentHash: input.contentHash,
          storageKey: input.storageKey,
          updatedAt: input.at,
        },
      });
  }

  /** Deletes the row; answers the removed record (to delete its object), or null when there was none. */
  async remove(accountId: string, writer: Writer = this.db): Promise<AccountPhotoRecord | null> {
    const [row] = await writer.delete(accountPhoto).where(eq(accountPhoto.accountId, accountId)).returning();
    return row ?? null;
  }

  /**
   * Atomic per-account claim of a change slot. Serialized by a transaction-scoped advisory lock on the account, so
   * concurrent callers (also from other API instances) see each other's claim: the row timestamp is re-read AFTER the
   * lock and, when the slot is free, bumped to `at` inside the same transaction. Answers false when the previous
   * attempt is younger than `minIntervalMs`. An account without a row has nothing to bump: the in-process guard of
   * the service covers it (single instance); this is documented in docs/implementation/profile-photo.md.
   */
  async claimSlot(accountId: string, at: Date, minIntervalMs: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account-photo:${accountId}`}, 0))`);
      const [row] = await tx.select().from(accountPhoto).where(eq(accountPhoto.accountId, accountId));
      if (row === undefined) return true;
      if (at.getTime() - row.updatedAt.getTime() < minIntervalMs) return false;
      await tx.update(accountPhoto).set({ updatedAt: at }).where(eq(accountPhoto.accountId, accountId));
      return true;
    });
  }

  transaction<T>(work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
