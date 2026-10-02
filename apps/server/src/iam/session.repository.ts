import { Inject, Injectable } from '@nestjs/common';
import { account, session, type AccountRole, type AccountStatus, type Database } from '@salesforce/db';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';
import type { AuditWriter } from './audit.service.js';

export interface SessionWithAccount {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly accountId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  readonly revokedAt: Date | null;
  readonly email: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
}

/** Sessions that ended this long ago are deleted by the opportunistic purge. */
export const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Storage of `session` (token hashes only). Owned by the identity module. */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(values: {
    id: string;
    accountId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(session).values({
      id: values.id,
      accountId: values.accountId,
      tokenHash: values.tokenHash,
      createdAt: values.createdAt,
      lastSeenAt: values.createdAt,
      expiresAt: values.expiresAt,
    });
  }

  /**
   * Creates the session and runs `writeAudit` in the SAME transaction (AUDIT-1): if the audit row cannot
   * be written the session row is rolled back, so no session exists whose token could ever be used.
   */
  async createWithAudit(
    values: { id: string; accountId: string; tokenHash: string; createdAt: Date; expiresAt: Date },
    writeAudit: (writer: AuditWriter) => Promise<void>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(session).values({
        id: values.id,
        accountId: values.accountId,
        tokenHash: values.tokenHash,
        createdAt: values.createdAt,
        lastSeenAt: values.createdAt,
        expiresAt: values.expiresAt,
      });
      await writeAudit(tx);
    });
  }

  async findByTokenHash(tokenHash: string): Promise<SessionWithAccount | null> {
    const [row] = await this.db
      .select({
        sessionId: session.id,
        tokenHash: session.tokenHash,
        accountId: session.accountId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastSeenAt: session.lastSeenAt,
        revokedAt: session.revokedAt,
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        status: account.status,
      })
      .from(session)
      .innerJoin(account, eq(account.id, session.accountId))
      .where(eq(session.tokenHash, tokenHash));
    return row === undefined ? null : (row as SessionWithAccount);
  }

  async touch(sessionId: string, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    await this.db
      .update(session)
      .set({ lastSeenAt, expiresAt })
      .where(and(eq(session.id, sessionId), isNull(session.revokedAt)));
  }

  /** Revokes one session. Returns false when it was already revoked (idempotent). */
  async revoke(sessionId: string, now: Date): Promise<boolean> {
    const revoked = await this.db
      .update(session)
      .set({ revokedAt: now })
      .where(and(eq(session.id, sessionId), isNull(session.revokedAt)))
      .returning({ id: session.id });
    return revoked.length > 0;
  }

  /** Revokes every live session of an account (password change, deactivation, administrative revoke). */
  async revokeAllForAccount(accountId: string, now: Date, writer: Pick<Database, 'update'> = this.db): Promise<number> {
    const revoked = await writer
      .update(session)
      .set({ revokedAt: now })
      .where(and(eq(session.accountId, accountId), isNull(session.revokedAt)))
      .returning({ id: session.id });
    return revoked.length;
  }

  /** Deletes sessions that expired or were revoked more than the retention ago. */
  async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - SESSION_RETENTION_MS);
    const removed = await this.db
      .delete(session)
      .where(or(lt(session.expiresAt, cutoff), lt(session.revokedAt, cutoff)))
      .returning({ id: session.id });
    return removed.length;
  }
}
