import { isSankhyaGatewayError, type SankhyaErrorKind } from '@salesforce/sankhya';
import { PermanentJobError, TransientJobError } from '../worker/job-contract.js';
import { classifyJobFailure } from '../worker/retry.js';

/**
 * Failure class stored in `sync_state.last_error_class`: the Sankhya error taxonomy
 * (`unavailable | auth | validation | rate_limit | temporary | permanent`), plus `unclassified` for
 * an unexpected error (a bug to surface; never retried blindly).
 */
export type SyncErrorClass = SankhyaErrorKind | 'unclassified';

export interface SyncFailure {
  readonly errorClass: SyncErrorClass;
  readonly errorCode: string | null;
  /** Secret-free, personal-data-free text for `sync_state.last_error_message` (<= 500 chars). */
  readonly message: string;
  readonly retry: boolean;
}

const MAX_MESSAGE_CHARS = 500;

/**
 * Classifies any failure of a mirror run. The message is stored in the database and shown in the
 * integration status, so only text that is secret-free by contract is kept: gateway errors and the
 * job errors of this codebase. Anything else (a database driver error can echo SQL text and values)
 * is reduced to its class and code.
 */
export function describeSyncFailure(error: unknown): SyncFailure {
  const classification = classifyJobFailure(error);

  if (isSankhyaGatewayError(error)) {
    return {
      errorClass: error.kind,
      errorCode: error.code,
      message: `${error.code}: ${error.message}`.slice(0, MAX_MESSAGE_CHARS),
      retry: error.retryable,
    };
  }
  if (error instanceof PermanentJobError || error instanceof TransientJobError) {
    return {
      errorClass: error instanceof TransientJobError ? 'temporary' : 'permanent',
      errorCode: null,
      message: error.message.slice(0, MAX_MESSAGE_CHARS),
      retry: classification.retry,
    };
  }
  if (classification.retry) {
    return {
      errorClass: 'temporary',
      errorCode: classification.errorCode ?? null,
      message: `Temporary infrastructure failure${classification.errorCode ? ` (${classification.errorCode})` : ''}; the run is retried automatically.`,
      retry: true,
    };
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : null;
  return {
    errorClass: 'unclassified',
    errorCode: code,
    message: `Unexpected error${code ? ` (${code})` : ''} during the mirror run; details are in the worker log. Not retried automatically.`,
    retry: false,
  };
}
