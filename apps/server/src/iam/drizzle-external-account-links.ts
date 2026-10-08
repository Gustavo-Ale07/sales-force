import { Inject, Injectable } from '@nestjs/common';
import {
  account,
  accountSellerLink,
  erpDirectoryUser,
  erpSeller,
  installationConfigurationVersion,
  session,
  syncState,
  type Database,
} from '@salesforce/db';
import { decideDirectorySeller, parseDirectoryUserCode, type DirectoryRefusal } from '@salesforce/domain';
import { and, count, eq, isNull, ne, sql } from 'drizzle-orm';
import { uuidv7 } from '../platform/ids.js';
import { DATABASE } from '../platform/tokens.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import type { DirectorySyncOutcome, ExternalAccountLinks } from './external-identity.js';

/** Not an Argon2id string: `PasswordHasher.verify` answers false on it, so a provisioned account has no local password. */
export const UNUSABLE_PASSWORD_HASH = '!external-directory-account';

/** Login handle of a provisioned account (stored in the legacy `account.email` column, which holds the login identifier). */
export const externalAccountHandle = (externalUserId: string): string => `sankhya:${externalUserId}`;

/** `sync_state.entity` of the mirror of the official ERP user -> seller relation. */
const DIRECTORY_ENTITY = 'directoryUsers';

/**
 * Refusals that say the ERP relation really no longer supports the link (an automatic link is then removed and the sessions are
 * revoked). `directory_stale` is not one of them: an old or missing mirror proves nothing, so it only denies (fail closed) and changes nothing.
 */
const DEFINITIVE: ReadonlySet<DirectoryRefusal> = new Set(['user_missing', 'no_seller', 'seller_inactive', 'seller_ambiguous', 'seller_claimed']);

/**
 * `ExternalAccountLinks` over PostgreSQL. Identity is `account.external_user_id` (the stable ERP user code), never a name.
 * The sync creates/reconciles a `seller` account only, in one transaction with its link and audit row, from the mirrored official
 * relation (`erp_directory_user`: CODUSU -> CODVEND) for a seller that is active, not deleted, claimed by no other user and linked to no
 * other account. No seller is ever matched by name, e-mail or a coincidence of codes; manual links and other roles are never touched.
 */
@Injectable()
export class DrizzleExternalAccountLinks implements ExternalAccountLinks {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async findAccountId(externalUserId: string): Promise<string | null> {
    const [row] = await this.db.select({ id: account.id }).from(account).where(eq(account.externalUserId, externalUserId));
    return row?.id ?? null;
  }

  async hasAutomaticLink(accountId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ sellerCode: accountSellerLink.sellerCode })
      .from(accountSellerLink)
      .where(and(eq(accountSellerLink.accountId, accountId), eq(accountSellerLink.source, 'sankhya_auto')))
      .limit(1);
    return row !== undefined;
  }

  async isSellerActive(sellerCode: number): Promise<boolean> {
    const [row] = await this.db
      .select({ code: erpSeller.code })
      .from(erpSeller)
      .where(and(eq(erpSeller.code, sellerCode), eq(erpSeller.active, true), isNull(erpSeller.deletedAt)));
    return row !== undefined;
  }

  async syncFromDirectory(input: { externalUserId: string; now: Date; maxMirrorAgeMs: number; allowCreate: boolean }): Promise<DirectorySyncOutcome> {
    const userCode = parseDirectoryUserCode(input.externalUserId);
    if (userCode === null) return { ok: false, refusal: 'invalid_identity', accountId: null, revoked: false };

    return this.db.transaction(async (tx) => {
      const [mirrored] = await tx
        .select({ sellerCode: erpDirectoryUser.sellerCode })
        .from(erpDirectoryUser)
        .where(and(eq(erpDirectoryUser.code, userCode), isNull(erpDirectoryUser.deletedAt)));
      let wantedSeller = mirrored?.sellerCode ?? null;

      // Serializes every claim on the same seller (`account_seller_link.seller_code` has no unique index and force_api cannot lock
      // `erp_seller` rows: it holds SELECT only), so two first logins for one seller cannot both pass the checks below.
      if (wantedSeller !== null) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'seller-link:' + String(wantedSeller)}, 0))`);
      // The worker may have moved the user while we waited for the lock: lock the seller we will actually decide on too.
      const [reread] = await tx
        .select({ sellerCode: erpDirectoryUser.sellerCode })
        .from(erpDirectoryUser)
        .where(and(eq(erpDirectoryUser.code, userCode), isNull(erpDirectoryUser.deletedAt)));
      const settled = reread?.sellerCode ?? null;
      if (settled !== wantedSeller) {
        wantedSeller = settled;
        if (wantedSeller !== null) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'seller-link:' + String(wantedSeller)}, 0))`);
      }

      const [existing] = await tx
        .select({ id: account.id, role: account.role })
        .from(account)
        .where(eq(account.externalUserId, input.externalUserId))
        // Serializes concurrent logins of the same directory user. (force_api holds UPDATE on `account`.)
        .for('update');
      if (existing !== undefined && existing.role !== 'seller') return { ok: true, accountId: existing.id, action: 'not_managed' } as const;
      if (existing === undefined && !input.allowCreate) return { ok: false, refusal: 'user_missing', accountId: null, revoked: false } as const;

      const [link] =
        existing === undefined
          ? []
          : await tx
              .select({ sellerCode: accountSellerLink.sellerCode, source: accountSellerLink.source })
              .from(accountSellerLink)
              .where(eq(accountSellerLink.accountId, existing.id));
      // An administrator's link is authoritative: the ERP relation never moves, removes or second-guesses it.
      if (existing !== undefined && link !== undefined && link.source === 'manual') return { ok: true, accountId: existing.id, action: 'not_managed' } as const;

      const [state] = await tx.select({ lastSuccessAt: syncState.lastSuccessAt }).from(syncState).where(eq(syncState.entity, DIRECTORY_ENTITY));
      const mirrorAgeMs = state?.lastSuccessAt == null ? null : Math.max(0, input.now.getTime() - state.lastSuccessAt.getTime());

      let sellerActive = false;
      let otherUsersOfSeller = 0;
      let otherAccountsOfSeller = 0;
      if (wantedSeller !== null) {
        const [seller] = await tx
          .select({ code: erpSeller.code })
          .from(erpSeller)
          .where(and(eq(erpSeller.code, wantedSeller), eq(erpSeller.active, true), isNull(erpSeller.deletedAt)));
        sellerActive = seller !== undefined;
        const [users] = await tx
          .select({ n: count() })
          .from(erpDirectoryUser)
          .where(and(eq(erpDirectoryUser.sellerCode, wantedSeller), isNull(erpDirectoryUser.deletedAt), ne(erpDirectoryUser.code, userCode)));
        otherUsersOfSeller = users?.n ?? 0;
        const [accounts] = await tx
          .select({ n: count() })
          .from(accountSellerLink)
          .where(
            existing === undefined
              ? eq(accountSellerLink.sellerCode, wantedSeller)
              : and(eq(accountSellerLink.sellerCode, wantedSeller), ne(accountSellerLink.accountId, existing.id)),
          );
        otherAccountsOfSeller = accounts?.n ?? 0;
      }

      const decision = decideDirectorySeller(
        { user: reread === undefined ? null : { sellerCode: wantedSeller }, sellerActive, otherUsersOfSeller, otherAccountsOfSeller, mirrorAgeMs },
        input.maxMirrorAgeMs,
      );

      if (!decision.ok) {
        const accountId = existing?.id ?? null;
        let revoked = false;
        if (existing !== undefined && link !== undefined && DEFINITIVE.has(decision.refusal)) {
          await tx.delete(accountSellerLink).where(and(eq(accountSellerLink.accountId, existing.id), eq(accountSellerLink.source, 'sankhya_auto')));
          await tx.update(session).set({ revokedAt: input.now }).where(and(eq(session.accountId, existing.id), isNull(session.revokedAt)));
          revoked = true;
          await this.audit.record(
            { action: AUDIT_ACTIONS.directoryLinkRevoked, actorAccountId: existing.id, detail: { reason: decision.refusal, sellerCode: link.sellerCode, userCode } },
            tx,
          );
        } else if (input.allowCreate) {
          // Session re-checks are denied without a row each: a stale mirror would otherwise write one per request.
          await this.audit.record(
            { action: AUDIT_ACTIONS.directoryLinkRefused, actorAccountId: accountId, detail: { reason: decision.refusal, userCode } },
            tx,
          );
        }
        return { ok: false, refusal: decision.refusal, accountId, revoked } as const;
      }

      const sellerCode = decision.sellerCode;
      const [version] = await tx
        .select({ id: installationConfigurationVersion.id })
        .from(installationConfigurationVersion)
        .where(eq(installationConfigurationVersion.isCurrent, true));
      if (version === undefined) {
        await this.audit.record({ action: AUDIT_ACTIONS.directoryLinkRefused, actorAccountId: existing?.id ?? null, detail: { reason: 'no_configuration', userCode } }, tx);
        return { ok: false, refusal: 'no_configuration', accountId: existing?.id ?? null, revoked: false } as const;
      }

      if (existing !== undefined) {
        if (link === undefined) {
          // A re-check never grants: a link someone removed stays removed until the next real login.
          if (!input.allowCreate) return { ok: true, accountId: existing.id, action: 'not_managed' } as const;
          await tx.insert(accountSellerLink).values({ accountId: existing.id, sellerCode, configVersionId: version.id, source: 'sankhya_auto' });
          await this.audit.record({ action: AUDIT_ACTIONS.accountSellerLinked, actorAccountId: existing.id, detail: { sellerCode, source: 'sankhya_auto' } }, tx);
          return { ok: true, accountId: existing.id, action: 'linked' } as const;
        }
        if (link.sellerCode === sellerCode) return { ok: true, accountId: existing.id, action: 'unchanged' } as const;
        // The ERP moved the user to another (valid, unclaimed) seller: follow it, never keep the old scope.
        await tx
          .update(accountSellerLink)
          .set({ sellerCode, configVersionId: version.id })
          .where(and(eq(accountSellerLink.accountId, existing.id), eq(accountSellerLink.source, 'sankhya_auto')));
        await tx.update(session).set({ revokedAt: input.now }).where(and(eq(session.accountId, existing.id), isNull(session.revokedAt)));
        await this.audit.record(
          { action: AUDIT_ACTIONS.accountSellerLinked, actorAccountId: existing.id, detail: { sellerCode, previousSellerCode: link.sellerCode, source: 'sankhya_auto' } },
          tx,
        );
        return { ok: true, accountId: existing.id, action: 'relinked' } as const;
      }

      const [seller] = await tx.select({ name: erpSeller.name }).from(erpSeller).where(eq(erpSeller.code, sellerCode));
      const id = uuidv7(input.now.getTime());
      const inserted = await tx
        .insert(account)
        .values({
          id,
          email: externalAccountHandle(input.externalUserId),
          displayName: seller?.name ?? externalAccountHandle(input.externalUserId),
          passwordHash: UNUSABLE_PASSWORD_HASH,
          role: 'seller',
          status: 'active',
          createdAt: input.now,
          externalUserId: input.externalUserId,
        })
        .onConflictDoNothing()
        .returning({ id: account.id });
      if (inserted.length === 0) {
        // The handle or the directory id is taken by an account this sync does not own: never overwrite it.
        await this.audit.record({ action: AUDIT_ACTIONS.directoryLinkRefused, actorAccountId: null, detail: { reason: 'conflict', userCode } }, tx);
        return { ok: false, refusal: 'conflict', accountId: null, revoked: false } as const;
      }
      await tx.insert(accountSellerLink).values({ accountId: id, sellerCode, configVersionId: version.id, source: 'sankhya_auto' });
      await this.audit.record(
        { action: AUDIT_ACTIONS.accountCreated, actorAccountId: null, detail: { accountId: id, role: 'seller', sellerCode, source: 'sankhya_directory' } },
        tx,
      );
      return { ok: true, accountId: id, action: 'created' } as const;
    });
  }
}
