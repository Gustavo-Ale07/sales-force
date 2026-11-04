import { maskUris } from './logger.js';

/**
 * D-Q: text stored in `sync_state.last_error_message` and `integration_outbox.last_error_message` is masked BEFORE it is
 * written. Only the class, the code and a short human text may remain: no Authorization header, token, password, secret,
 * URL with credentials, connection string or Sankhya host. Pure and deterministic; the targets come from the caller.
 */

const REDACTED = '[redacted]';
const HOST_PLACEHOLDER = '[host]';
const MIN_SECRET_LENGTH = 6;

export interface MaskTargets {
  /** Hostnames (no scheme) that must never be stored, e.g. the Sankhya API host. */
  readonly hosts?: readonly string[];
  /** Literal secret values (client id/secret, X-Token) that must never be stored. */
  readonly secrets?: readonly string[];
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SENSITIVE_KEY = /(["']?)\b(x-token|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|authorization|password|passwd|senha|secret|token)\b\1(\s*[:=]\s*)("[^"]*"|'[^']*'|(?:bearer\s+)?[^\s,;&}"']+)/gi;
const BEARER = /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const USERINFO = /\b[^\s:@/]+:[^\s@/]+@[^\s/]+/g;

export function maskErrorMessage(text: string, targets: MaskTargets = {}): string {
  let masked = maskUris(text);
  for (const secret of targets.secrets ?? []) {
    if (secret.length >= MIN_SECRET_LENGTH) masked = masked.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  }
  for (const host of targets.hosts ?? []) {
    if (host.length > 0) masked = masked.replace(new RegExp(escapeRegExp(host), 'gi'), HOST_PLACEHOLDER);
  }
  masked = masked.replace(SENSITIVE_KEY, (_match, quote: string, key: string, separator: string) => `${quote}${key}${quote}${separator}${REDACTED}`);
  return masked.replace(BEARER, `Bearer ${REDACTED}`).replace(JWT, REDACTED).replace(USERINFO, `${REDACTED}@${HOST_PLACEHOLDER}`);
}

let configured: MaskTargets = {};

/** Registered once at worker start (`config/worker-env.ts`, the only place that reads the Sankhya settings). */
export function setMaskTargets(targets: MaskTargets): void {
  configured = targets;
}

/** `maskErrorMessage` with the registered targets: what every writer of a stored error text uses. */
export function maskStoredError(text: string): string {
  return maskErrorMessage(text, configured);
}
