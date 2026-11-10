import { SankhyaGatewayError, classifyHttpFailure } from '../errors.js';

/**
 * CACSP.confirmarNota — NEEDS VALIDATION (spike S3, SNK-7 D-4/D-10, decision "confirmação no envio").
 * The shape below comes from an UNOFFICIAL community SDK, not from the Sandbox: module mgecom, body
 * `{ nota: { NUNOTA: { $: "<number>" } } }`. The response is read defensively (see `parseConfirmarNotaResponse`)
 * and its MASKED text is returned so the owner can inspect the real format in the Sandbox test.
 */
export const CONFIRMAR_NOTA_PATH = '/gateway/v1/mgecom/service.sbr?serviceName=CACSP.confirmarNota&outputType=json';

export type ConfirmOrderOutcome = 'confirmed' | 'already_confirmed' | 'release_pending';

export interface ConfirmOrderResult {
  readonly outcome: ConfirmOrderOutcome;
  /** The ERP response with sensitive keys masked and truncated: for logs only, to learn the real format. */
  readonly maskedResponse: string;
}

export function buildConfirmarNotaBody(erpOrderNumber: number): { nota: { NUNOTA: { $: string } } } {
  if (!Number.isInteger(erpOrderNumber) || erpOrderNumber < 1 || erpOrderNumber > 2_147_483_647) {
    throw new SankhyaGatewayError('validation', { code: 'invalid_order_number', message: 'The ERP order number is not valid.' });
  }
  return { nota: { NUNOTA: { $: String(erpOrderNumber) } } };
}

export function buildConfirmarNotaRequestText(erpOrderNumber: number): string {
  return JSON.stringify({ serviceName: 'CACSP.confirmarNota', requestBody: buildConfirmarNotaBody(erpOrderNumber) });
}

const MASKED_RESPONSE_MAX = 1500;
const SENSITIVE_KEY = /token|senha|password|secret|authorization|cookie|chave|key/i;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function maskValue(input: unknown, depth: number): unknown {
  if (depth > 8) return '[...]';
  if (Array.isArray(input)) return input.slice(0, 50).map((entry) => maskValue(entry, depth + 1));
  if (isRecord(input)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(input)) out[key] = SENSITIVE_KEY.test(key) ? '[masked]' : maskValue(entry, depth + 1);
    return out;
  }
  return input;
}

/** Masked, truncated text of a response body (JSON when parseable, else a truncated plain text). */
export function maskConfirmResponse(body: string): string {
  let text: string;
  try {
    text = JSON.stringify(maskValue(JSON.parse(body), 0));
  } catch {
    text = body.replace(/\s+/g, ' ');
  }
  return text.length > MASKED_RESPONSE_MAX ? `${text.slice(0, MASKED_RESPONSE_MAX)}…` : text;
}

const ALREADY_CONFIRMED = /j[aá]\s+(est[aá]\s+|foi\s+)?confirmad|already\s+confirmed/i;
const RELEASE_PENDING = /libera[cç][aã]o|liberar|aguardando\s+libera|pendente\s+de\s+libera|release/i;

function messageOf(parsed: Record<string, unknown>): string {
  const raw = parsed['statusMessage'];
  return typeof raw === 'string' ? raw : '';
}

/** True when the response body lists generated releases (non-empty `liberacoes`-like key, whatever its wrapper). */
function listsGeneratedReleases(node: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (Array.isArray(node)) return node.some((entry) => listsGeneratedReleases(entry, depth + 1));
  if (!isRecord(node)) return false;
  for (const [key, entry] of Object.entries(node)) {
    if (/libera/i.test(key)) {
      if (Array.isArray(entry) && entry.length > 0) return true;
      if (isRecord(entry) && Object.keys(entry).length > 0) return true;
    }
    if (listsGeneratedReleases(entry, depth + 1)) return true;
  }
  return false;
}

/**
 * Defensive reading (the real format was NEVER observed):
 *  - HTTP != 200 -> classified like every other call (unavailable/auth/rate limit/temporary/...);
 *  - body not JSON -> `temporary` (the note stays included; only the confirmation is repeated);
 *  - status "1" -> `confirmed`, or `release_pending` when the response lists generated releases;
 *  - status != "1": message says already confirmed -> `already_confirmed` (success, idempotent);
 *    message mentions a release -> `release_pending` (NOT an error); anything else -> `validation`
 *    `erp_refused_confirmation` with the (truncated) ERP reason. A refusal never re-includes the note.
 */
export function parseConfirmarNotaResponse(status: number, body: string, retryAfterMs?: number): ConfirmOrderResult {
  if (status !== 200) throw classifyHttpFailure(status, 'ERP order confirmation', retryAfterMs);
  const maskedResponse = maskConfirmResponse(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'confirmarNota: the response was not JSON.', cause });
  }
  if (!isRecord(parsed)) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'confirmarNota: unexpected response shape.' });
  }
  const message = messageOf(parsed);
  if (String(parsed['status']) === '1') {
    return { outcome: listsGeneratedReleases(parsed['responseBody']) ? 'release_pending' : 'confirmed', maskedResponse };
  }
  if (ALREADY_CONFIRMED.test(message)) return { outcome: 'already_confirmed', maskedResponse };
  if (RELEASE_PENDING.test(message)) return { outcome: 'release_pending', maskedResponse };
  throw new SankhyaGatewayError('validation', {
    code: 'erp_refused_confirmation',
    message: `The ERP did not confirm the order: ${message.slice(0, 300) || 'no message'}.`,
  });
}
