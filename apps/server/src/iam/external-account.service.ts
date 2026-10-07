import {
  account,
  accountSellerLink,
  erpSeller,
  installationConfigurationVersion,
  type AccountRole,
  type Database,
} from '@salesforce/db';
import { ACCOUNT_ROLES, isValidSellerCode, normalizeUsername } from '@salesforce/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from '../platform/ids.js';
import type { Clock } from '../platform/tokens.js';
import { AUDIT_ACTIONS, type AuditService } from './audit.service.js';
import { UNUSABLE_PASSWORD_HASH } from './drizzle-external-account-links.js';
import { CredentialSecret, type ExternalIdentityVerifier } from './external-identity.js';

export type ExternalAccountRefusal =
  | 'invalid_role'
  | 'seller_code_required'
  | 'seller_code_not_allowed'
  | 'username_taken'
  | 'external_identity_taken'
  | 'seller_unavailable'
  | 'seller_already_linked'
  | 'no_configuration_version'
  | 'invalid_credentials'
  | 'identity_inactive'
  | 'verifier_unavailable'
  | 'verifier_rate_limited';

const MESSAGES: Record<ExternalAccountRefusal, string> = {
  invalid_role: 'The role must be one of: admin, manager, seller, technical.',
  seller_code_required: 'A seller account needs an explicit --seller-code.',
  seller_code_not_allowed: '--seller-code applies only to a seller account.',
  username_taken: 'A Force account with this login already exists; nothing was changed (an existing account is never converted).',
  external_identity_taken: 'This Sankhya user is already linked to a Force account; nothing was changed.',
  seller_unavailable: 'The seller code does not exist in the ERP mirror, is inactive or was deleted.',
  seller_already_linked: 'The seller code is already linked to another account; nothing was changed.',
  no_configuration_version: 'There is no current installation configuration version to bind the seller link to.',
  invalid_credentials: 'The Sankhya login or password was rejected; no account was created.',
  identity_inactive: 'The Sankhya user is not active; no account was created.',
  verifier_unavailable: 'The identity verifier is unavailable; no account was created.',
  verifier_rate_limited: 'The identity verifier is rate limiting; try again later. No account was created.',
};

/** Operator-facing refusal. The message names the rule, never a credential or an identity. */
export class ExternalAccountError extends Error {
  constructor(readonly reason: ExternalAccountRefusal) {
    super(MESSAGES[reason]);
    this.name = 'ExternalAccountError';
  }
}

export interface CreateExternalAccountInput {
  readonly username: string;
  readonly displayName: string;
  readonly role: string;
  readonly sellerCode?: number | undefined;
  /** The Sankhya password of that user: used once for the verifier call and then dropped; never persisted, logged or audited. */
  readonly password: string;
}

/**
 * Operator creation of a Force account linked to a Sankhya user (PRE_LINKED mode). The directory identity is NEVER typed:
 * it comes from a real authentication through the internal verifier (the CLI never talks to Sankhya). The account has an
 * unusable local password, an explicit role and, for a seller, an explicit seller link (never inferred from a name).
 * It only ever creates: an existing login (including the local administrator) is refused, never converted or linked.
 * Cheap refusals come first so a password is not sent when the outcome is already known; the verifier runs outside any
 * transaction; account, link and audit row commit together or not at all.
 */
export class ExternalAccountService {
  #operator: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly verifier: ExternalIdentityVerifier,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  attributeTo(operator: string): this {
    this.#operator = operator;
    return this;
  }

  async createExternalAccount(input: CreateExternalAccountInput, signal: AbortSignal): Promise<string> {
    if (!(ACCOUNT_ROLES as readonly string[]).includes(input.role)) throw new ExternalAccountError('invalid_role');
    const role = input.role as AccountRole;
    const username = normalizeUsername(input.username).toLowerCase();
    if (role === 'seller') {
      if (input.sellerCode === undefined || !isValidSellerCode(input.sellerCode)) throw new ExternalAccountError('seller_code_required');
    } else if (input.sellerCode !== undefined) {
      throw new ExternalAccountError('seller_code_not_allowed');
    }

    await this.precheck(username, input.sellerCode);

    let result;
    try {
      result = await this.verifier.verify({ login: input.username.trim(), password: new CredentialSecret(input.password) }, signal);
    } catch {
      throw new ExternalAccountError('verifier_unavailable');
    }
    if ('fail' in result) {
      if (result.fail === 'rate_limited') throw new ExternalAccountError('verifier_rate_limited');
      if (result.fail === 'unavailable') throw new ExternalAccountError('verifier_unavailable');
      throw new ExternalAccountError('invalid_credentials');
    }
    const identity = result.ok;
    if (identity.active !== true) throw new ExternalAccountError('identity_inactive');
    if (typeof identity.externalUserId !== 'string' || identity.externalUserId === '') throw new ExternalAccountError('invalid_credentials');

    const now = this.clock();
    const id = uuidv7(now.getTime());
    await this.db.transaction(async (tx) => {
      await this.checkUsernameFree(tx, username);
      const [bound] = await tx.select({ id: account.id }).from(account).where(eq(account.externalUserId, identity.externalUserId));
      if (bound !== undefined) throw new ExternalAccountError('external_identity_taken');
      let configVersionId: string | null = null;
      if (role === 'seller') {
        await this.lockUsableSeller(tx, input.sellerCode as number);
        configVersionId = await this.currentConfigVersion(tx);
      }
      const inserted = await tx
        .insert(account)
        .values({
          id,
          email: username, // legacy column name: holds the login identifier
          displayName: input.displayName.trim(),
          passwordHash: UNUSABLE_PASSWORD_HASH,
          role,
          status: 'active',
          createdAt: now,
          externalUserId: identity.externalUserId,
        })
        .onConflictDoNothing()
        .returning({ id: account.id });
      if (inserted.length === 0) {
        // A concurrent operator won: report which rule it was (the transaction is rolled back by the throw).
        const [bound] = await tx.select({ id: account.id }).from(account).where(eq(account.externalUserId, identity.externalUserId));
        throw new ExternalAccountError(bound === undefined ? 'username_taken' : 'external_identity_taken');
      }
      if (role === 'seller') {
        await tx.insert(accountSellerLink).values({ accountId: id, sellerCode: input.sellerCode as number, configVersionId: configVersionId as string });
      }
      const detail = {
        accountId: id,
        role,
        ...(role === 'seller' ? { sellerCode: input.sellerCode as number } : {}),
        source: 'operator_external',
        ...(this.#operator === null ? {} : { operator: this.#operator }),
      };
      await this.audit.record({ action: AUDIT_ACTIONS.accountCreated, actorAccountId: null, detail }, tx);
      if (role === 'seller') {
        await this.audit.record(
          { action: AUDIT_ACTIONS.accountSellerLinked, actorAccountId: null, detail: { accountId: id, sellerCode: input.sellerCode as number, ...(this.#operator === null ? {} : { operator: this.#operator }) } },
          tx,
        );
      }
    });
    return id;
  }

  private async precheck(username: string, sellerCode: number | undefined): Promise<void> {
    await this.checkUsernameFree(this.db, username);
    if (sellerCode !== undefined) {
      const [seller] = await this.db
        .select({ code: erpSeller.code })
        .from(erpSeller)
        .where(and(eq(erpSeller.code, sellerCode), eq(erpSeller.active, true), isNull(erpSeller.deletedAt)));
      if (seller === undefined) throw new ExternalAccountError('seller_unavailable');
      const [taken] = await this.db.select({ id: accountSellerLink.accountId }).from(accountSellerLink).where(eq(accountSellerLink.sellerCode, sellerCode));
      if (taken !== undefined) throw new ExternalAccountError('seller_already_linked');
      await this.currentConfigVersion(this.db);
    }
  }

  private async checkUsernameFree(reader: Pick<Database, 'select'>, username: string): Promise<void> {
    const [row] = await reader.select({ id: account.id }).from(account).where(sql`lower(${account.email}) = ${username}`);
    if (row !== undefined) throw new ExternalAccountError('username_taken');
  }

  private async currentConfigVersion(reader: Pick<Database, 'select'>): Promise<string> {
    const [version] = await reader
      .select({ id: installationConfigurationVersion.id })
      .from(installationConfigurationVersion)
      .where(eq(installationConfigurationVersion.isCurrent, true));
    if (version === undefined) throw new ExternalAccountError('no_configuration_version');
    return version.id;
  }

  /** Row lock serializes two operators claiming the same seller (`seller_code` has no unique index). */
  private async lockUsableSeller(tx: Pick<Database, 'select' | 'execute'>, sellerCode: number): Promise<void> {
    // Same key as the directory sync (drizzle-external-account-links.ts): an operator claim and an automatic claim on one seller serialize.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'seller-link:' + String(sellerCode)}, 0))`);
    const [seller] = await tx
      .select({ code: erpSeller.code })
      .from(erpSeller)
      .where(and(eq(erpSeller.code, sellerCode), eq(erpSeller.active, true), isNull(erpSeller.deletedAt)))
      .for('update');
    if (seller === undefined) throw new ExternalAccountError('seller_unavailable');
    const [taken] = await tx.select({ id: accountSellerLink.accountId }).from(accountSellerLink).where(eq(accountSellerLink.sellerCode, sellerCode));
    if (taken !== undefined) throw new ExternalAccountError('seller_already_linked');
  }
}
