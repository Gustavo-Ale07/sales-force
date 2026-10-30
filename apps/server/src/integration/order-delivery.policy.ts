import { isSankhyaGatewayError, type SankhyaErrorKind } from '@salesforce/sankhya';

/**
 * Failure policy of the order delivery (SNK-7 D-2, D-3, D-4; SNK-4). Pure and deterministic: the
 * service gives the facts, this decides what the outbox row and the order become. Nothing here sends
 * anything.
 */

/** Total attempts before a temporary failure is given up (D-2). */
export const MAX_DELIVERY_ATTEMPTS = 8;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;
/** An authentication failure is retried slowly and does not consume an attempt (repeating it can lock the integration user). */
export const AUTH_RETRY_DELAY_MS = 15 * 60_000;
/** A row left `processing` longer than this lost its worker; it becomes `unknown` and is re-verified by origin. */
export const STALE_PROCESSING_MS = 10 * 60_000;

export function backoffMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
}

/** Where in one delivery attempt the failure happened. */
export type DeliveryPhase = 'verify' | 'include' | 'confirm' | 'reread';

export interface FailureFacts {
  readonly phase: DeliveryPhase;
  /** Attempts used including the current one. */
  readonly attemptCount: number;
  /** The order may already exist in the ERP (a send was tried, or its NUNOTA is known). */
  readonly mayExist: boolean;
  /** The ERP order number is known (included, confirmation or reread pending). */
  readonly hasErpNumber: boolean;
}

export type DeliveryOutcome =
  /** Final refusal: outbox `rejected`, order `rejected` ("Falha no envio"). */
  | { readonly kind: 'reject'; readonly errorClass: string; readonly errorCode: string }
  /** Try again later. `status` is the outbox status meanwhile (`unknown` = a send may have happened). */
  | {
      readonly kind: 'retry';
      readonly status: 'pending' | 'unknown';
      readonly delayMs: number;
      readonly consumesAttempt: boolean;
      readonly errorClass: string;
      readonly errorCode: string;
    }
  /** Needs a person: outbox `unknown` with no next attempt; the order shows "Envio em verificação" / "aguardando confirmação". */
  | { readonly kind: 'park'; readonly errorClass: string; readonly errorCode: string };

interface ClassifiedError {
  readonly kind: SankhyaErrorKind | 'unclassified';
  readonly code: string;
  readonly retryAfterMs: number | null;
}

function classify(error: unknown): ClassifiedError {
  if (isSankhyaGatewayError(error)) return { kind: error.kind, code: error.code, retryAfterMs: error.retryAfterMs };
  return { kind: 'unclassified', code: 'unclassified', retryAfterMs: null };
}

export function decideFailure(error: unknown, facts: FailureFacts): DeliveryOutcome {
  const failure = classify(error);
  const meanwhile: 'pending' | 'unknown' = facts.mayExist ? 'unknown' : 'pending';

  switch (failure.kind) {
    case 'validation':
    case 'permanent': {
      // Never retried blindly (.claude/rules/sankhya.md). At `include` the origin check of this very attempt
      // proved the order absent, so a refusal is final. Elsewhere the order may exist in the ERP:
      // rejecting it would hide a real order, a person must look at it.
      // More than one ERP order with the same origin id: orders exist, so it is never "rejected".
      if (failure.code === 'duplicate_origin') return park(failure);
      if (facts.phase === 'include') return reject(failure);
      return facts.mayExist || facts.hasErpNumber ? park(failure) : reject(failure);
    }
    case 'auth':
      return {
        kind: 'retry',
        status: meanwhile,
        delayMs: AUTH_RETRY_DELAY_MS,
        consumesAttempt: false,
        errorClass: 'auth',
        errorCode: failure.code,
      };
    case 'rate_limit':
      return retryOrGiveUp(failure, facts, meanwhile, Math.max(backoffMs(facts.attemptCount), failure.retryAfterMs ?? 0));
    case 'unavailable':
    case 'temporary':
    case 'unclassified': {
      // After the send started, a timeout or 5xx proves nothing: the order may exist. The next attempt
      // re-verifies by origin id before any resend (SNK-4).
      const status = facts.phase === 'verify' ? meanwhile : 'unknown';
      return retryOrGiveUp(failure, facts, status, backoffMs(facts.attemptCount));
    }
  }
}

function retryOrGiveUp(
  failure: ClassifiedError,
  facts: FailureFacts,
  status: 'pending' | 'unknown',
  delayMs: number,
): DeliveryOutcome {
  if (facts.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    // The order exists in the ERP but is not confirmed / not verified: do not call it a failed send (D-4).
    if (facts.hasErpNumber) return park({ ...failure, kind: 'temporary' });
    return { kind: 'reject', errorClass: 'exhausted', errorCode: failure.code };
  }
  return { kind: 'retry', status, delayMs, consumesAttempt: true, errorClass: failure.kind, errorCode: failure.code };
}

function reject(failure: ClassifiedError): DeliveryOutcome {
  return { kind: 'reject', errorClass: failure.kind, errorCode: failure.code };
}

function park(failure: ClassifiedError): DeliveryOutcome {
  return { kind: 'park', errorClass: failure.kind, errorCode: failure.code };
}
