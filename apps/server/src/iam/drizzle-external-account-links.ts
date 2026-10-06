import { Inject, Injectable } from '@nestjs/common';
import {
  account,
  accountSellerLink,
  erpSeller,
  installationConfigurationVersion,
  type Database,
} from '@salesforce/db';
import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '../platform/ids.js';
import { DATABASE } from '../platform/tokens.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import type { ExternalAccountLinks } from './external-identity.js';

/** Not an Argon2id string: `PasswordHasher.verify` answers false on it, so a provisioned account has no local password. */
export const UNUSABLE_PASSWORD_HASH = '!external-directory-account';

/** Login handle of a provisioned account (stored in the legacy `account.email` column, which holds the login identifier). */
export const externalAccountHandle = (externalUserId: string): string => `sankhya:${externalUserId}`;

/**
 * `ExternalAccountLinks` over PostgreSQL. Identity is `account.external_user_id` (the stable ERP user code), never
 * a name. Provisioning creates a `seller` account only, in one transaction with its seller link and audit row, for a
 * mirrored seller that is active, not deleted and not linked to another account. No seller is ever matched by name.
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

  async isSellerActive(sellerCode: number): Promise<boolean> {
    const [row] = await this.db
      .select({ code: erpSeller.code })
      .from(erpSeller)
      .where(and(eq(erpSeller.code, sellerCode), eq(erpSeller.active, true), isNull(erpSeller.deletedAt)));
    return row !== undefined;
  }

  async provisionSeller(input: { externalUserId: string; sellerCode: number; now: Date }): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const [seller] = await tx
        .select({ name: erpSeller.name })
        .from(erpSeller)
        .where(and(eq(erpSeller.code, input.sellerCode), eq(erpSeller.active, true), isNull(erpSeller.deletedAt)))
        // Row lock: `account_seller_link.seller_code` has no unique index, so two logins claiming the same seller are
        // serialized here and the loser then sees the winner's link below.
        .for('update');
      if (seller === undefined) return null;
      // Same directory user already provisioned by a concurrent login (serialized by the lock above): reuse it.
      const [existing] = await tx.select({ id: account.id }).from(account).where(eq(account.externalUserId, input.externalUserId));
      if (existing !== undefined) return existing.id;
      const [taken] = await tx
        .select({ accountId: accountSellerLink.accountId })
        .from(accountSellerLink)
        .where(eq(accountSellerLink.sellerCode, input.sellerCode));
      if (taken !== undefined) return null;
      const [version] = await tx
        .select({ id: installationConfigurationVersion.id })
        .from(installationConfigurationVersion)
        .where(eq(installationConfigurationVersion.isCurrent, true));
      if (version === undefined) return null;

      const id = uuidv7(input.now.getTime());
      const inserted = await tx
        .insert(account)
        .values({
          id,
          email: externalAccountHandle(input.externalUserId),
          displayName: seller.name,
          passwordHash: UNUSABLE_PASSWORD_HASH,
          role: 'seller',
          status: 'active',
          createdAt: input.now,
          externalUserId: input.externalUserId,
        })
        .onConflictDoNothing()
        .returning({ id: account.id });
      if (inserted.length === 0) {
        // Lost a race for the same directory user: the winner's account is the answer.
        const [winner] = await tx.select({ id: account.id }).from(account).where(eq(account.externalUserId, input.externalUserId));
        return winner?.id ?? null;
      }
      await tx.insert(accountSellerLink).values({ accountId: id, sellerCode: input.sellerCode, configVersionId: version.id });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.accountCreated,
          actorAccountId: null,
          detail: { accountId: id, role: 'seller', sellerCode: input.sellerCode, source: 'external_directory' },
        },
        tx,
      );
      return id;
    });
  }
}
