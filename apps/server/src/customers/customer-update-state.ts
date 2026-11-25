import type { CustomerReasonCodeSchema, CustomerState, UpdateCustomerResponse } from '@salesforce/contracts';
import { customerStateLabel, customerStateOfDelivery } from '@salesforce/domain';
import type { z } from 'zod';

/** Outbox identity of an edit command (D-AP). Shared by the API (writes it) and the worker (delivers it). */
export const CUSTOMER_UPDATE_AGGREGATE = 'customer_update';
export const CUSTOMER_UPDATE_OPERATION = 'customer.update';

type ReasonCode = z.infer<typeof CustomerReasonCodeSchema>;

/** What the API reads of the outbox row of an edit to answer. */
export interface UpdateOutboxFacts {
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly status: string;
  readonly nextAttemptAt: Date | null;
  /** `<code>: <message>` as the worker stored it (sanitized, masked). */
  readonly lastErrorMessage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const GENERIC_REFUSAL = 'O Sankhya recusou a alteração do cliente. Confira os dados e tente novamente.';

/** Unwraps the adapter's own sentence ("The ERP refused the partner: <reason>."); anything else is the generic text. */
export function updateRefusalText(stored: string | null): string {
  // Only the required-field refusal carries text that is safe to show; any other ERP text may name a third party.
  if (!(stored ?? '').startsWith('partner_required_field')) return GENERIC_REFUSAL;
  const match = /The ERP refused the partner(?:: (.+?)\.?\s*$| \(no message\)\.?\s*$)/s.exec(stored ?? '');
  const reason = match?.[1]?.trim()?.slice(0, 300);
  return reason === undefined || reason === '' ? GENERIC_REFUSAL : `O Sankhya recusou a alteração: ${reason}`;
}

export function stateOfUpdate(status: string): Exclude<CustomerState, 'draft'> {
  return customerStateOfDelivery(status);
}

export function reasonOfUpdate(facts: Pick<UpdateOutboxFacts, 'status' | 'nextAttemptAt' | 'lastErrorMessage'>): { readonly code: ReasonCode; readonly message: string } | null {
  if (facts.status === 'rejected') return { code: 'erp_refused', message: updateRefusalText(facts.lastErrorMessage) };
  // Parked for a person: not a refusal, the seller waits.
  if (facts.status === 'unknown' && facts.nextAttemptAt === null) {
    return { code: 'review_needed', message: 'O Sankhya ainda não confirmou esta alteração; ela está em verificação pelo backoffice.' };
  }
  return null;
}

export function toUpdateResponse(facts: UpdateOutboxFacts, customerCode: number): UpdateCustomerResponse {
  const state = stateOfUpdate(facts.status);
  const reason = reasonOfUpdate(facts);
  return {
    updateId: facts.aggregateId,
    customerCode,
    state,
    sendState: facts.status === 'confirmed' ? 'sent' : 'pending',
    stateLabel: customerStateLabel(state),
    reasonCode: reason?.code ?? null,
    reasonMessage: reason?.message ?? null,
    updatedAt: facts.updatedAt.toISOString(),
  };
}

/** 422 field map of a refused edit: the field is a hint from the words of the ERP text; unknown = `_`. */
export function updateRefusalFields(message: string): Record<string, string> {
  const hints: ReadonlyArray<readonly [RegExp, string]> = [
    [/e-?mail/i, 'email'],
    [/telefone|fone/i, 'phone'],
    [/observa/i, 'notes'],
  ];
  const hint = hints.find(([pattern]) => pattern.test(message));
  return { [hint?.[1] ?? '_']: message };
}

export const EDITABLE_CUSTOMER_FIELDS = ['phone', 'email', 'notes', 'contacts', 'addresses'] as const;
/** The only fields the worker can deliver today: contacts and addresses have no validated ERP mapping (S5.2); notes (OBSERVACOES) is proven by roteiro T5. */
export const DELIVERABLE_CUSTOMER_FIELDS = ['phone', 'email', 'notes'] as const;
