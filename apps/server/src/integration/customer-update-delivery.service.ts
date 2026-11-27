import { CustomerFieldSchemas } from '@salesforce/contracts';
import { isSankhyaGatewayError, type PartnerEditableFields, type SankhyaPartnerWritePort } from '@salesforce/sankhya';
import { z } from 'zod';
import type { Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import { backoffMs, decideFailure, STALE_PROCESSING_MS, type DeliveryOutcome, type DeliveryPhase } from './order-delivery.policy.js';
import { refusalReason } from './customer-delivery.service.js';
import type { ClaimedCustomerUpdate, CustomerUpdateDeliveryStore, CustomerUpdateFailureRecord } from './customer-update-delivery.store.js';

/** The command as the API wrote it (external input: validated, never trusted). Only the three deliverable fields exist here. */
export const CustomerUpdateCommandSchema = z.object({
  customerCode: z.number().int().min(1),
  changes: z
    .object({
      phone: CustomerFieldSchemas.phone.nullable().optional(),
      email: CustomerFieldSchemas.email.nullable().optional(),
      notes: CustomerFieldSchemas.notes.nullable().optional(),
      priceTableCode: z.number().int().min(0).optional(),
    })
    .strict(),
});
export type CustomerUpdateCommand = z.infer<typeof CustomerUpdateCommandSchema>;

export interface CustomerUpdateDeliveryDeps {
  readonly store: CustomerUpdateDeliveryStore;
  readonly gateway: SankhyaPartnerWritePort;
  readonly logger: Logger;
  readonly now: Clock;
}

const DEFAULT_SWEEP_LIMIT = 10;
const MAX_BACKOFF_ATTEMPT = 32;
const KEYS = ['phone', 'email', 'notes'] as const;

const norm = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
};

/** Every changed field already holds the asked value in the ERP (an empty value equals `null`). */
export function editApplied(changes: CustomerUpdateCommand['changes'], erp: PartnerEditableFields): boolean {
  const tableApplied = changes.priceTableCode === undefined || changes.priceTableCode === erp.priceTableCode;
  return tableApplied && KEYS.every((key) => changes[key] === undefined || norm(changes[key]) === norm(erp[key]));
}

/**
 * Delivers `customer.update` commands to the ERP (D-AP). An edit is a STATE write (same values twice is harmless), so SNK-4 for edits is
 * the reread: before sending, and after a lost answer, the editable columns are read; when they already hold the asked values the
 * command is confirmed without a second write. After the write the columns are read again and must match, otherwise a person looks.
 * No network call inside a database transaction. Failures reuse the order policy; a refusal is final and shown to the seller.
 */
export class CustomerUpdateDeliveryService {
  constructor(private readonly deps: CustomerUpdateDeliveryDeps) {}

  async runDue(options: { readonly signal?: AbortSignal | undefined; readonly limit?: number | undefined } = {}): Promise<{ processed: number; recovered: number }> {
    const now = this.deps.now();
    const recovered = await this.deps.store.recoverStale(now, new Date(now.getTime() - STALE_PROCESSING_MS));
    const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
    let processed = 0;
    while (processed < limit && options.signal?.aborted !== true) {
      const claimed = await this.deps.store.claimNext(this.deps.now());
      if (claimed === null) break;
      processed += 1;
      try {
        await this.deliver(claimed, options.signal);
      } catch (error) {
        this.deps.logger.error({ err: error, outboxId: claimed.outboxId }, 'customer update attempt failed unexpectedly');
      }
    }
    return { processed, recovered };
  }

  private async deliver(claimed: ClaimedCustomerUpdate, signal: AbortSignal | undefined): Promise<void> {
    const { gateway } = this.deps;
    const callOptions = signal === undefined ? {} : { signal };
    const parsed = CustomerUpdateCommandSchema.safeParse(claimed.payload);
    if (!parsed.success) {
      await this.record(claimed, null, { kind: 'reject', status: 'rejected', errorClass: 'validation', errorCode: 'invalid_command', message: 'The stored command is not valid.', nextAttemptAt: null, consumesAttempt: true });
      return;
    }
    const { customerCode, changes } = parsed.data;
    let phase: DeliveryPhase = 'verify';
    const mayExist = claimed.previousStatus === 'unknown';
    try {
      const before = await gateway.readPartnerEditableFields(customerCode, callOptions);
      if (before === null) {
        await this.record(claimed, customerCode, { kind: 'reject', status: 'rejected', errorClass: 'validation', errorCode: 'partner_not_found', message: 'The customer does not exist in the ERP.', nextAttemptAt: null, consumesAttempt: true });
        return;
      }
      if (!editApplied(changes, before)) {
        phase = 'include';
        await this.deps.store.markSending(claimed.outboxId, this.deps.now());
        await gateway.updatePartner({ code: customerCode, changes }, callOptions);
      }
      phase = 'reread';
      const after = await gateway.readPartnerEditableFields(customerCode, callOptions);
      if (after === null || !editApplied(changes, after)) {
        await this.record(claimed, customerCode, { kind: 'park', status: 'unknown', errorClass: 'permanent', errorCode: 'reread_mismatch', message: 'The customer read back from the ERP does not match the edit; a person has to check it.', nextAttemptAt: null, consumesAttempt: true });
        return;
      }
      await this.deps.store.confirm({ claimed, customerCode, fields: after, at: this.deps.now() });
      this.deps.logger.info({ outboxId: claimed.outboxId, customerCode, attempts: claimed.attemptCount }, 'customer update delivered to the ERP');
    } catch (error) {
      const outcome = decideFailure(error, { phase, attemptCount: claimed.attemptCount, mayExist: mayExist || phase !== 'verify', hasErpNumber: false });
      await this.applyOutcome(claimed, customerCode, outcome, outcome.kind === 'reject' ? refusalReason(error) : errorMessage(error), phase);
    }
  }

  private async record(claimed: ClaimedCustomerUpdate, customerCode: number | null, part: Pick<CustomerUpdateFailureRecord, 'kind' | 'status' | 'errorClass' | 'errorCode' | 'message' | 'nextAttemptAt' | 'consumesAttempt'>): Promise<void> {
    await this.deps.store.fail({ claimed, customerCode, at: this.deps.now(), ...part });
    this.deps.logger.warn({ outboxId: claimed.outboxId, errorCode: part.errorCode, outcome: part.kind }, 'customer update did not complete');
  }

  private async applyOutcome(claimed: ClaimedCustomerUpdate, customerCode: number, outcome: DeliveryOutcome, message: string, phase: DeliveryPhase): Promise<void> {
    const at = this.deps.now();
    // Exhausted retries are never a refusal: the seller could not fix a temporary trouble. Keep trying at the slowest cadence.
    if (outcome.kind === 'reject' && outcome.errorClass === 'exhausted') {
      await this.deps.store.fail({
        claimed, customerCode, at, message, kind: 'retry', errorClass: 'exhausted', errorCode: outcome.errorCode,
        status: phase === 'verify' && claimed.previousStatus !== 'unknown' ? 'pending' : 'unknown',
        nextAttemptAt: new Date(at.getTime() + backoffMs(MAX_BACKOFF_ATTEMPT)),
        consumesAttempt: true,
      });
      return;
    }
    const base = { claimed, customerCode, errorClass: outcome.errorClass, errorCode: outcome.errorCode, message, at };
    let record: CustomerUpdateFailureRecord;
    if (outcome.kind === 'reject') record = { ...base, kind: 'reject', status: 'rejected', nextAttemptAt: null, consumesAttempt: true };
    else if (outcome.kind === 'park') record = { ...base, kind: 'park', status: 'unknown', nextAttemptAt: null, consumesAttempt: true };
    else record = { ...base, kind: 'retry', status: outcome.status, nextAttemptAt: new Date(at.getTime() + outcome.delayMs), consumesAttempt: outcome.consumesAttempt };
    await this.deps.store.fail(record);
    this.deps.logger.warn({ outboxId: claimed.outboxId, outcome: outcome.kind, errorClass: outcome.errorClass, errorCode: outcome.errorCode }, 'customer update did not complete');
  }
}

function errorMessage(error: unknown): string {
  if (isSankhyaGatewayError(error)) return `${error.kind}: ${error.code}`;
  return `${error instanceof Error ? error.name : 'Error'}: unclassified failure`;
}
