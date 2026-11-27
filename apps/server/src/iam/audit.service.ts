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
  /** The account set or replaced its own profile photo (version and size only; never image content). */
  accountPhotoChanged: 'account.photo_changed',
  /** The account removed its own profile photo. */
  accountPhotoRemoved: 'account.photo_removed',
  /** A scoped request was refused because the account has no valid seller link (ids only, no PII). */
  noSellerScope: 'authz.no_seller_scope',
  /** External login refused: the directory seller does not agree with the account link (no codes, no PII). */
  loginLinkMismatch: 'auth.login.link_mismatch',
  /** The app login of a profile with no mobile use was refused AFTER valid credentials (ids and role only). */
  loginAppNotPermitted: 'auth.login.app_not_permitted',
  /** A verified directory user could not get/keep an automatic seller link (reason code, ids only; the client sees a uniform error). */
  directoryLinkRefused: 'auth.directory.link_refused',
  /** An automatic seller link was removed because the official ERP relation no longer supports it; the account's sessions were revoked. */
  directoryLinkRevoked: 'auth.directory.link_revoked',
  /** The ERP blocks the user: the account's sessions were revoked; the (manual) link record was left as is. */
  directorySessionRevoked: 'auth.directory.session_revoked',
  /** The admin changed the discount limits (W-39, DISC-3): previous and new values, never free text. */
  discountLimitsChanged: 'config.discount_limits_changed',
  /** A manager or admin created, changed or removed one per-seller discount rule (seller, kind, code and percents only). */
  sellerDiscountRuleChanged: 'config.seller_discount_rule_changed',
  /** The Force configuration (days without sync, default price table) was changed on the site: previous and new values only. */
  forceConfigChanged: 'config.force_changed',
  /** CFG-8: the worker stored a new configuration version read from Sankhya (versions, hashes, changed keys; no values). */
  configSankhyaSynced: 'config.sankhya_synced',
  orderCreated: 'order.created',
  orderReplaced: 'order.replaced',
  /** P-09: the seller decided the changed prices of a draft. Counts only, never prices. */
  orderPriceReviewed: 'order.price_reviewed',
  /** D-Y: the seller (or a manager) deleted a quote/order that never reached Sankhya. Identifiers and the total only. */
  orderDeleted: 'order.deleted',
  /** D-U (a): a quote that never reached Sankhya became an order in place (ids and TOPs only). */
  orderConverted: 'order.converted',
  /** D-AR: a customer creation was recorded and queued for the ERP (ids, seller code and person type only; no personal data). */
  customerRegistrationRequested: 'customer.registration_requested',
  /** D-AR (I-1): a creation was refused because the document is taken (refusal id and reason code only; no document, name or holder). */
  customerRegistrationRefused: 'customer.registration_refused',
  /** D-AR: the worker created (or adopted by origin) the customer in the ERP and reread it (ids and codes only). */
  customerErpCreated: 'customer.erp_created',
  /** D-AR: the ERP refused the creation for good (class and stable code only; no personal data). */
  customerErpRejected: 'customer.erp_rejected',
  /** D-AR: the outcome is not known (or the reread did not match) and a person has to look. */
  customerErpUnknown: 'customer.erp_unknown',
  /** D-AP: an edit of an existing customer was refused because edit delivery to the ERP is not approved (ids and field names only; no values). */
  customerUpdateRefused: 'customer.update_refused',
  /** D-AP: an edit was recorded for delivery (ids and the names of the changed fields only; no values). */
  customerUpdateRequested: 'customer.update_requested',
  /** D-AP: the worker wrote the edit to the ERP and the reread matched (ids and field names only). */
  customerUpdateDelivered: 'customer.update_delivered',
  /** D-AP: the ERP definitively refused the edit (error class and code only). */
  customerUpdateRejected: 'customer.update_rejected',
  /** D-AP: the outcome of an edit is not known (or the reread did not match) and a person has to look. */
  customerUpdateUnknown: 'customer.update_unknown',
  /** Spike S1.8: the worker wrote the account's photo to its ERP user (ids and codes only, never the image). */
  profilePhotoErpWritten: 'account.photo_erp_written',
  /** Spike S1.8: the photo write was refused for good (class and stable code only). */
  profilePhotoErpRejected: 'account.photo_erp_rejected',
  orderTemplateCreated: 'order_template.created',
  orderTemplateReplaced: 'order_template.replaced',
  orderTemplateDeleted: 'order_template.deleted',
  /** A template produced a new draft order (ids and counts only). */
  orderTemplateUsed: 'order_template.used',
  /** RF-ACT-1: a task was created / completed / cancelled (ids and type only, never the title or description). */
  taskCreated: 'task.created',
  taskCompleted: 'task.completed',
  taskCancelled: 'task.cancelled',
  /** RF-NOT-1: a push device was registered or removed (ids and platform only, never the token). */
  pushDeviceRegistered: 'push_device.registered',
  pushDeviceRemoved: 'push_device.removed',
  /** "Repetir último pedido": a new draft order was produced from the customer's most recent order. */
  orderRepeatedFromLast: 'order.repeated_from_last',
  orderDuplicatedAsOrder: 'order.duplicated_as_order',
  /** An ERP submission was requested; it is refused while submission is disabled (SNK-4/SNK-6). */
  orderSubmitAttempted: 'order.submit_attempted',
  orderApprovalRequested: 'order.approval_requested',
  orderApprovalInvalidated: 'order.approval_invalidated',
  orderApprovalApproved: 'order.approval_approved',
  orderApprovalRejected: 'order.approval_rejected',
  /** A decision was refused because the caller's role cannot decide the requested level (DISC-4). */
  orderApprovalDenied: 'order.approval_denied',
  orderSubmitDiscountBlocked: 'order.submit_discount_blocked',
  /** A submitted order has lines above the seller's resolved discount limit (informational; counts only). */
  orderSubmitDiscountAboveLimit: 'order.submit_discount_above_limit',
  /** A draft was refused on submission because its customer is no longer eligible (ids and reason only). */
  orderSubmitCustomerIneligible: 'order.submit_customer_ineligible',
  /** SNK-7: the order was queued for the ERP (outbox row created in the same transaction). */
  orderErpEnqueued: 'order.erp_enqueued',
  /** SNK-7 D-5: a queued order was cancelled while its outbox row was still pending. */
  /** SNK-7: the worker delivered the order (ERP number in the detail). */
  orderErpSent: 'order.erp_sent',
  /** SNK-7: the delivery ended in an integration error (class and code only). */
  orderErpRejected: 'order.erp_rejected',
  /** SNK-7: the delivery needs attention (ambiguous result or included but unconfirmed). */
  orderErpUnknown: 'order.erp_unknown',
  /** SNK-7 D-6: the payload was built and stored, nothing was sent. */
  orderErpDryRun: 'order.erp_dry_run',
  /** SNK-7 M1: an operator re-queued an already delivered order with the same idempotency key (ids and ERP number only). */
  orderErpResendRequested: 'order.erp_resend_requested',
  orderDeliveryVerifyRequested: 'order.delivery_verify_requested',
  /** Owner ruling 2026-11-27 "Editar pedido": who asked to edit a sent order and the NUNOTA it replaces (ids and numbers only). */
  orderEditRequested: 'order.edit_requested',
  /** The worker deleted the old note in Sankhya and re-queued the edited order (old NUNOTA; the new one is on the following order.erp_sent). */
  orderEditDeleted: 'order.edit_deleted',
  /** The worker refused the edit after the live eligibility read (reason code only); nothing was deleted. */
  orderEditRefused: 'order.edit_refused',
  /** RT-1: the ERP note is confirmed gone from Sankhya (two consecutive confirmed-absent reads): the order leaves the lists (ids and ERP number only). */
  orderErpRemoved: 'order.erp_removed',
  /** RT-1: a removed order's note came back in Sankhya: the order is visible again (ids and ERP number only). */
  orderErpRestored: 'order.erp_restored',
  /** RF-IMP: a spreadsheet import ran (type, row counts, created and rejected counts; never file content or personal data). */
  importCompleted: 'import.completed',
  /** RF-DSH-6: a spreadsheet export was produced (resource, format and row count; never the content). */
  dataExported: 'data.exported',
  /** Owner ruling 2026-11-27: the server code was rotated (every session revoked; count only, never the code). `actorAccountId` is null for the operator script. */
  serverCodeRotated: 'config.server_code_rotated',
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
