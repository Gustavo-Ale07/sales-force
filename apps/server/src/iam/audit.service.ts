import { Inject, Injectable } from '@nestjs/common';
import { auditLog, type Database } from '@salesforce/db';
import { CLOCK, DATABASE, type Clock } from '../platform/tokens.js';
import { uuidv7 } from '../platform/ids.js';

/** Audited identity events (security model §13). Stable strings: dashboards and reviews filter on them. */
export const AUDIT_ACTIONS = {
  loginSuccess: 'auth.login.success',
  loginFailure: 'auth.login.failure',
  loginBlocked: 'auth.login.blocked',
  lockout: 'auth.lockout',
  unlock: 'auth.unlock',
  logout: 'auth.logout',
  sessionRevoked: 'auth.session.revoked',
  accountCreated: 'account.created',
  accountPasswordChanged: 'account.password_changed',
  accountStatusChanged: 'account.status_changed',
  accountSellerLinked: 'account.seller_linked',
  /** A scoped request was refused because the account has no valid seller link (ids only, no PII). */
  noSellerScope: 'authz.no_seller_scope',
  /** External login refused: the directory seller does not agree with the account link (no codes, no PII). */
  loginLinkMismatch: 'auth.login.link_mismatch',
  /** A verified directory user could not get/keep an automatic seller link (reason code, ids only; the client sees a uniform error). */
  directoryLinkRefused: 'auth.directory.link_refused',
  /** An automatic seller link was removed because the official ERP relation no longer supports it; the account's sessions were revoked. */
  directoryLinkRevoked: 'auth.directory.link_revoked',
  orderCreated: 'order.created',
  orderReplaced: 'order.replaced',
  orderDiscarded: 'order.discarded',
  orderTemplateCreated: 'order_template.created',
  orderTemplateReplaced: 'order_template.replaced',
  orderTemplateDeleted: 'order_template.deleted',
  /** A template produced a new draft order (ids and counts only). */
  orderTemplateUsed: 'order_template.used',
  /** "Repetir último pedido": a new draft order was produced from the customer's most recent order. */
  orderRepeatedFromLast: 'order.repeated_from_last',
  /** An ERP submission was requested; it is refused while submission is disabled (SNK-4/SNK-6). */
  orderSubmitAttempted: 'order.submit_attempted',
  /** A draft was refused on submission because its customer is no longer eligible (ids and reason only). */
  orderSubmitCustomerIneligible: 'order.submit_customer_ineligible',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditDetailValue = string | number | boolean | null;
export type AuditDetail = Readonly<Record<string, AuditDetailValue>>;

export interface AuditEntry {
  readonly action: AuditAction;
  /** Null when no account is resolved (login with an unknown e-mail, system actions). */
  readonly actorAccountId: string | null;
  readonly detail?: AuditDetail;
}

/** Anything that can insert a row: the database or a transaction (so audit can join a business write). */
export type AuditWriter = Pick<Database, 'insert'>;

/** Keys that must never be audited (P-22). A hit is a programming error, surfaced in tests. */
const FORBIDDEN_DETAIL_KEY = /pass(word)?|token|secret|cookie|authorization|credential/i;

export class ForbiddenAuditDetailError extends Error {
  constructor(key: string) {
    super(`Audit detail key "${key}" looks like a credential and is never recorded.`);
    this.name = 'ForbiddenAuditDetailError';
  }
}

export function assertAuditDetailSafe(detail: AuditDetail | undefined): void {
  for (const key of Object.keys(detail ?? {})) {
    if (FORBIDDEN_DETAIL_KEY.test(key)) throw new ForbiddenAuditDetailError(key);
  }
}

/**
 * Append-only audit trail (`audit_log`). Callers pass identifiers and facts only: never passwords,
 * tokens, cookies or request bodies. E-mails of unknown accounts are recorded as a short hash
 * fingerprint, because that text is attacker-chosen.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async record(entry: AuditEntry, writer: AuditWriter = this.db): Promise<void> {
    assertAuditDetailSafe(entry.detail);
    const at = this.clock();
    await writer.insert(auditLog).values({
      id: uuidv7(at.getTime()),
      at,
      actorAccountId: entry.actorAccountId,
      action: entry.action,
      detail: entry.detail ?? null,
    });
  }
}
