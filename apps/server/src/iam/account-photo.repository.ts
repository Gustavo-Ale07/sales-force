import { Inject, Injectable } from '@nestjs/common';
import { accountPhoto, type Database } from '@salesforce/db';
import { eq } from 'drizzle-orm';
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

  transaction<T>(work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
