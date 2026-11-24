import { accountPhoto, accountSellerLink, erpDirectoryUser, integrationOutbox, account, type Database } from '@salesforce/db';
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { ACCOUNT_PHOTO_AGGREGATE, ACCOUNT_PHOTO_OPERATION } from '../iam/account-photo.repository.js';
import { AUDIT_ACTIONS, type AuditService } from '../iam/audit.service.js';
import { maskStoredError } from '../observability/mask-error-message.js';

const MESSAGE_MAX = 500;

/** One claimed `profile_photo.write` outbox row. */
export interface ClaimedPhotoCommand {
  readonly outboxId: string;
  readonly accountId: string;
  /** `photo:<accountId>:<version>`, the stable idempotency key of the write. */
  readonly originKey: string;
  readonly payload: unknown;
  /** Attempts used including the current one. */
  readonly attemptCount: number;
}

export type ErpUserResolution =
  | { readonly kind: 'user'; readonly code: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous' };

export interface PhotoFailureRecord {
  readonly claimed: ClaimedPhotoCommand;
  readonly kind: 'reject' | 'retry';
  readonly status: 'rejected' | 'unknown' | 'pending';
  readonly errorClass: string;
  readonly errorCode: string;
  readonly message: string;
  readonly nextAttemptAt: Date | null;
  /** `false` = an authentication failure: the attempt is given back. */
  readonly consumesAttempt: boolean;
  readonly at: Date;
}

/** Persistence of the photo delivery. Every method is its own short transaction; none calls the ERP. */
export interface ProfilePhotoDeliveryStore {
  recoverStale(now: Date, cutoff: Date): Promise<number>;
  claimNext(now: Date): Promise<ClaimedPhotoCommand | null>;
  /** The version (prefix of the content hash) of the account's current photo; `null` = no photo any more. */
  currentVersion(accountId: string): Promise<string | null>;
  /** The ERP user of the account: its own external user id, else the one directory user of its linked seller (CFG-2). */
  resolveErpUser(accountId: string): Promise<ErpUserResolution>;
  markSending(outboxId: string, at: Date): Promise<void>;
  /** Outbox `confirmed` (image dropped from the payload) and audit: one transaction. */
  confirm(input: { readonly claimed: ClaimedPhotoCommand; readonly userCode: number; readonly at: Date }): Promise<void>;
  fail(input: PhotoFailureRecord): Promise<void>;
}

export class DrizzleProfilePhotoDeliveryStore implements ProfilePhotoDeliveryStore {
  constructor(
    private readonly database: Database,
    private readonly audit: Pick<AuditService, 'record'>,
  ) {}

  async recoverStale(now: Date, cutoff: Date): Promise<number> {
    return this.database.transaction(async (tx) => {
      const stale = await tx
        .select({ id: integrationOutbox.id })
        .from(integrationOutbox)
        .where(
          and(
            eq(integrationOutbox.aggregateType, ACCOUNT_PHOTO_AGGREGATE),
            eq(integrationOutbox.operation, ACCOUNT_PHOTO_OPERATION),
            eq(integrationOutbox.status, 'processing'),
            lt(integrationOutbox.updatedAt, cutoff),
          ),
        )
        .for('update', { skipLocked: true });
      for (const item of stale) {
        await tx
          .update(integrationOutbox)
          .set({
            status: 'unknown',
            nextAttemptAt: now,
            lastStep: 'waiting_retry',
            lastErrorClass: 'interrupted',
            lastErrorMessage: 'The worker stopped during the attempt; the photo is a state write and is simply sent again.',
            updatedAt: now,
          })
          .where(eq(integrationOutbox.id, item.id));
      }
      return stale.length;
    });
  }

  async claimNext(now: Date): Promise<ClaimedPhotoCommand | null> {
    return this.database.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(integrationOutbox)
        .where(
          and(
            eq(integrationOutbox.aggregateType, ACCOUNT_PHOTO_AGGREGATE),
            eq(integrationOutbox.operation, ACCOUNT_PHOTO_OPERATION),
            inArray(integrationOutbox.status, ['pending', 'unknown']),
            isNotNull(integrationOutbox.nextAttemptAt),
            lte(integrationOutbox.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(integrationOutbox.nextAttemptAt), asc(integrationOutbox.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (due === undefined) return null;
      const [row] = await tx
        .update(integrationOutbox)
        .set({ status: 'processing', attemptCount: sql`${integrationOutbox.attemptCount} + 1`, lastStep: 'sending', updatedAt: now })
        .where(eq(integrationOutbox.id, due.id))
        .returning();
      if (row === undefined) return null;
      return { outboxId: row.id, accountId: row.aggregateId, originKey: row.originId ?? '', payload: row.payload, attemptCount: row.attemptCount };
    });
  }

  async currentVersion(accountId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ version: sql<string>`substring(${accountPhoto.contentHash} from 1 for 32)` })
      .from(accountPhoto)
      .where(eq(accountPhoto.accountId, accountId))
      .limit(1);
    return row?.version ?? null;
  }

  async resolveErpUser(accountId: string): Promise<ErpUserResolution> {
    const [owner] = await this.database.select({ externalUserId: account.externalUserId }).from(account).where(eq(account.id, accountId)).limit(1);
    const own = owner?.externalUserId ?? null;
    if (own !== null && /^[1-9][0-9]{0,9}$/.test(own) && Number(own) <= 2_147_483_647) return { kind: 'user', code: Number(own) };
    const [link] = await this.database.select({ sellerCode: accountSellerLink.sellerCode }).from(accountSellerLink).where(eq(accountSellerLink.accountId, accountId)).limit(1);
    if (link === undefined) return { kind: 'none' };
    const users = await this.database
      .select({ code: erpDirectoryUser.code })
      .from(erpDirectoryUser)
      .where(and(eq(erpDirectoryUser.sellerCode, link.sellerCode), isNull(erpDirectoryUser.deletedAt)))
      .limit(2);
    if (users.length === 0) return { kind: 'none' };
    if (users.length > 1) return { kind: 'ambiguous' };
    return { kind: 'user', code: users[0]!.code };
  }

  async markSending(outboxId: string, at: Date): Promise<void> {
    await this.database.update(integrationOutbox).set({ lastStep: 'sending', updatedAt: at }).where(eq(integrationOutbox.id, outboxId));
  }

  async confirm(input: { readonly claimed: ClaimedPhotoCommand; readonly userCode: number; readonly at: Date }): Promise<void> {
    const { claimed, userCode, at } = input;
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({
          status: 'confirmed',
          nextAttemptAt: null,
          lastStep: 'confirmed',
          lastErrorClass: null,
          lastErrorMessage: null,
          erpReference: String(userCode),
          payload: sql`${integrationOutbox.payload} - 'imageBase64'`,
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, claimed.outboxId));
      await this.audit.record(
        { action: AUDIT_ACTIONS.profilePhotoErpWritten, actorAccountId: null, detail: { accountId: claimed.accountId, outboxId: claimed.outboxId, erpUserCode: userCode, attempts: claimed.attemptCount } },
        tx,
      );
    });
  }

  async fail(input: PhotoFailureRecord): Promise<void> {
    const { claimed, at } = input;
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({
          status: input.status,
          nextAttemptAt: input.nextAttemptAt,
          lastStep: input.kind === 'reject' ? null : 'waiting_retry',
          lastErrorClass: input.errorClass,
          lastErrorMessage: maskStoredError(`${input.errorCode}: ${input.message}`).slice(0, MESSAGE_MAX),
          ...(input.kind === 'reject' ? { payload: sql`${integrationOutbox.payload} - 'imageBase64'` } : {}),
          ...(input.consumesAttempt ? {} : { attemptCount: sql`greatest(${integrationOutbox.attemptCount} - 1, 0)` }),
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, claimed.outboxId));
      if (input.kind === 'reject') {
        await this.audit.record(
          { action: AUDIT_ACTIONS.profilePhotoErpRejected, actorAccountId: null, detail: { accountId: claimed.accountId, outboxId: claimed.outboxId, errorClass: input.errorClass, errorCode: input.errorCode } },
          tx,
        );
      }
    });
  }
}
