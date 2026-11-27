import { Inject, Injectable } from '@nestjs/common';
import { serverCode, type Database } from '@salesforce/db';
import { DATABASE } from '../platform/tokens.js';

/** Storage of `server_code`: one row holding only the SHA-256 (hex) of the secret. Owned by the identity module. */
@Injectable()
export class ServerCodeRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The hash of the active code, or null when none was ever generated (the guard then refuses everything). */
  async activeHash(): Promise<string | null> {
    const [row] = await this.db.select({ codeHash: serverCode.codeHash }).from(serverCode).limit(1);
    return row?.codeHash ?? null;
  }

  /** Hash and creation date of the active code (for the operator CLI), or null. */
  async activeSummary(): Promise<{ codeHash: string; createdAt: Date } | null> {
    const [row] = await this.db.select({ codeHash: serverCode.codeHash, createdAt: serverCode.createdAt }).from(serverCode).limit(1);
    return row ?? null;
  }

  /** Replaces the active code inside the caller's transaction (delete then insert: the single-row index allows no overlap). */
  async replace(
    tx: Pick<Database, 'delete' | 'insert'>,
    values: { id: string; codeHash: string; createdAt: Date; rotatedByAccountId: string | null },
  ): Promise<void> {
    await tx.delete(serverCode);
    await tx.insert(serverCode).values(values);
  }

  transaction<T>(work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
