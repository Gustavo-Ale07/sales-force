import { Inject, Injectable } from '@nestjs/common';
import type { AccountRole, AccountStatus, Database } from '@salesforce/db';
import { isValidSellerCode, normalizeEmail } from '@salesforce/domain';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, DATABASE, type Clock } from '../platform/tokens.js';
import { AccountRepository } from './account.repository.js';
import { AUDIT_ACTIONS, AuditService, type AuditDetail } from './audit.service.js';
import { PASSWORD_HASHER } from './iam-tokens.js';
import type { PasswordHasher } from './password-hasher.js';
import { checkPasswordPolicy, describePasswordViolations, type PasswordViolation } from './password-policy.js';
import { emailThrottleKey } from './session-crypto.js';
import { SessionRepository } from './session.repository.js';
import { ThrottleRepository } from './throttle.repository.js';

export class PasswordPolicyError extends Error {
  readonly violations: readonly PasswordViolation[];
  constructor(violations: readonly PasswordViolation[]) {
    super(describePasswordViolations(violations));
    this.name = 'PasswordPolicyError';
    this.violations = violations;
  }
}

export class AccountAlreadyExistsError extends Error {
  constructor() {
    super('An account with this e-mail already exists.');
    this.name = 'AccountAlreadyExistsError';
  }
}

export class AccountNotFoundError extends Error {
  constructor() {
    super('Account not found.');
    this.name = 'AccountNotFoundError';
  }
}

export class InvalidSellerCodeError extends Error {
  constructor() {
    super('A seller code must be an integer of 1 or more (0 is the "no seller" placeholder, never a seller).');
    this.name = 'InvalidSellerCodeError';
  }
}

/**
 * Who performed an administrative change: an account, or `null` for the operator CLI / seed. For the
 * scripts, `operator` names the person who ran them (see `operatorIdentity`) and is written to the
 * audit detail: an action with no actor account is otherwise attributable to nobody.
 */
export interface ActorRef {
  readonly accountId: string | null;
  readonly operator?: string;
}

export const CLI_ACTOR: ActorRef = { accountId: null };

/**
 * Account administration used by the operator CLI and the development seed (RF-IAM-1). No HTTP
 * surface exists for it in Phase 0 (user/team/role admin endpoints are not in the contracts). Every
 * change is audited in the same transaction, without any secret in the audit detail.
 */
@Injectable()
export class AccountService {
  #operator: string | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(ThrottleRepository) private readonly throttle: ThrottleRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Attributes every audit row of this instance to the person running the script (operator CLI, seed). */
  attributeTo(operator: string): this {
    this.#operator = operator;
    return this;
  }

  private detailOf(actor: ActorRef, detail: AuditDetail): AuditDetail {
    const operator = actor.operator ?? this.#operator;
    return operator === null || operator === undefined ? detail : { ...detail, operator };
  }

  /** Creates an active account. Throws `PasswordPolicyError` / `AccountAlreadyExistsError`. Returns the id. */
  async createAccount(
    input: { email: string; displayName: string; password: string; role: AccountRole },
    actor: ActorRef = CLI_ACTOR,
  ): Promise<string> {
    const violations = checkPasswordPolicy(input.password);
    if (violations.length > 0) throw new PasswordPolicyError(violations);

    const passwordHash = await this.hasher.hash(input.password);
    const now = this.clock();
    const id = uuidv7(now.getTime());
    const email = normalizeEmail(input.email);

    await this.db.transaction(async (tx) => {
      const inserted = await this.accounts.insert(
        { id, email, displayName: input.displayName.trim(), passwordHash, role: input.role, createdAt: now },
        tx,
      );
      if (!inserted) throw new AccountAlreadyExistsError();
      await this.audit.record(
        { action: AUDIT_ACTIONS.accountCreated, actorAccountId: actor.accountId, detail: this.detailOf(actor, { accountId: id, role: input.role }) },
        tx,
      );
    });
    return id;
  }

  /** Replaces the password and ends every live session of the account (the "session version" bump). */
  async setPassword(accountId: string, password: string, actor: ActorRef = CLI_ACTOR): Promise<void> {
    const violations = checkPasswordPolicy(password);
    if (violations.length > 0) throw new PasswordPolicyError(violations);
    if ((await this.accounts.findById(accountId)) === null) throw new AccountNotFoundError();

    const passwordHash = await this.hasher.hash(password);
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      await this.accounts.updatePasswordHash(accountId, passwordHash, tx);
      const revoked = await this.sessions.revokeAllForAccount(accountId, now, tx);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.accountPasswordChanged,
          actorAccountId: actor.accountId,
          detail: this.detailOf(actor, { accountId, sessionsRevoked: revoked }),
        },
        tx,
      );
    });
  }

  /** Activates or deactivates. Deactivation ends every live session at once. */
  async setStatus(accountId: string, status: AccountStatus, actor: ActorRef = CLI_ACTOR): Promise<void> {
    if ((await this.accounts.findById(accountId)) === null) throw new AccountNotFoundError();
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      await this.accounts.updateStatus(accountId, status, tx);
      const revoked = status === 'active' ? 0 : await this.sessions.revokeAllForAccount(accountId, now, tx);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.accountStatusChanged,
          actorAccountId: actor.accountId,
          detail: this.detailOf(actor, { accountId, status, sessionsRevoked: revoked }),
        },
        tx,
      );
    });
  }

  /** Links the account to the seller code the installation configuration names (CFG-2). */
  async linkSeller(
    accountId: string,
    sellerCode: number,
    configVersionId: string,
    actor: ActorRef = CLI_ACTOR,
  ): Promise<void> {
    if (!isValidSellerCode(sellerCode)) throw new InvalidSellerCodeError();
    await this.db.transaction(async (tx) => {
      await this.accounts.upsertSellerLink({ accountId, sellerCode, configVersionId }, tx);
      await this.audit.record(
        { action: AUDIT_ACTIONS.accountSellerLinked, actorAccountId: actor.accountId, detail: this.detailOf(actor, { accountId, sellerCode }) },
        tx,
      );
    });
  }

  /** Clears the lockout of an e-mail address (operator action). Returns false when there was nothing to clear. */
  async unlock(email: string, actor: ActorRef = CLI_ACTOR): Promise<boolean> {
    const found = await this.accounts.findByEmail(email);
    const cleared = await this.throttle.clear(emailThrottleKey(normalizeEmail(email)));
    await this.audit.record({
      action: AUDIT_ACTIONS.unlock,
      actorAccountId: actor.accountId,
      detail: this.detailOf(actor, { accountId: found?.id ?? null, cleared }),
    });
    return cleared;
  }
}
