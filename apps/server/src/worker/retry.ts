import { isSankhyaGatewayError } from '@salesforce/sankhya';
import { PermanentJobError, TransientJobError } from './job-contract.js';

/**
 * Failure classification for jobs (`.claude/rules/backend.md` "Transactions and jobs"): only
 * transient and rate-limit failures are retried, with the exponential backoff configured on the
 * queue; everything else is surfaced (dead-letter queue) and never retried blindly.
 */
export interface FailureClassification {
  readonly retry: boolean;
  /** Stable label stored with the failed job (never a message that could carry secrets). */
  readonly errorClass: string;
  readonly errorCode?: string;
}

const TRANSIENT_NODE_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
]);

/** PostgreSQL SQLSTATE classes/codes that are temporary: connection (08), shutdown (57P0x), capacity (53), serialization/deadlock. */
function isTransientPgCode(code: string): boolean {
  return code.startsWith('08') || code.startsWith('57P0') || code.startsWith('53') || code === '40001' || code === '40P01';
}

export function classifyJobFailure(error: unknown): FailureClassification {
  if (error instanceof PermanentJobError) return { retry: false, errorClass: 'permanent' };
  if (error instanceof TransientJobError) return { retry: true, errorClass: 'transient' };
  if (isSankhyaGatewayError(error)) {
    return { retry: error.retryable, errorClass: error.kind, errorCode: error.code };
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (TRANSIENT_NODE_CODES.has(code) || isTransientPgCode(code)) {
      return { retry: true, errorClass: 'transient', errorCode: code };
    }
  }
  // Unknown errors are not retried: an unclassified failure is a bug to surface, and repeating it
  // could repeat a side effect (SNK-4). The caller must classify it first.
  return { retry: false, errorClass: 'unclassified' };
}
