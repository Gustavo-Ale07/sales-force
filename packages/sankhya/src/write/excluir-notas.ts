import { SankhyaGatewayError, classifyHttpFailure } from '../errors.js';
import { maskConfirmResponse } from './confirmar-nota.js';

/**
 * CACSP.excluirNotas — VALIDATED in the Sandbox for an UNCONFIRMED order (spike F-51, §9.67): module mgecom, body
 * `{"notas":{"nota":[{"NUNOTA":"<string>"}]}}` (NUNOTA a plain string), HTTP 200, `status` "1", empty `responseBody`; the header,
 * items and titles are physically removed and no cancellation record remains. The format comes from a third-party SDK and worked
 * in the Sandbox. The behaviour on a confirmed note is NOT validated: the worker never calls this for one (the domain predicate
 * `canEditOrder` and a live read gate it) and any refusal here is a `validation` error, never retried.
 */
export const EXCLUIR_NOTAS_PATH = '/gateway/v1/mgecom/service.sbr?serviceName=CACSP.excluirNotas&outputType=json';

export interface DeleteOrderResult {
  /** The ERP response, masked and truncated: for logs only. */
  readonly maskedResponse: string;
}

export function buildExcluirNotasBody(erpOrderNumber: number): { notas: { nota: { NUNOTA: string }[] } } {
  if (!Number.isInteger(erpOrderNumber) || erpOrderNumber < 1 || erpOrderNumber > 2_147_483_647) {
    throw new SankhyaGatewayError('validation', { code: 'invalid_order_number', message: 'The ERP order number is not valid.' });
  }
  return { notas: { nota: [{ NUNOTA: String(erpOrderNumber) }] } };
}

export function buildExcluirNotasRequestText(erpOrderNumber: number): string {
  return JSON.stringify({ serviceName: 'CACSP.excluirNotas', requestBody: buildExcluirNotasBody(erpOrderNumber) });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/**
 * HTTP != 200 -> classified like every call; body not JSON -> `temporary` (the caller re-reads the note before anything else);
 * status "1" -> deleted; any other status -> `validation` `erp_refused_delete` with the truncated ERP reason (permanent).
 */
export function parseExcluirNotasResponse(status: number, body: string, retryAfterMs?: number): DeleteOrderResult {
  if (status !== 200) throw classifyHttpFailure(status, 'ERP order deletion', retryAfterMs);
  const maskedResponse = maskConfirmResponse(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'excluirNotas: the response was not JSON.', cause });
  }
  if (!isRecord(parsed)) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'excluirNotas: unexpected response shape.' });
  }
  if (String(parsed['status']) === '1') return { maskedResponse };
  const raw = parsed['statusMessage'];
  const message = typeof raw === 'string' ? raw : '';
  throw new SankhyaGatewayError('validation', {
    code: 'erp_refused_delete',
    message: `The ERP did not delete the order: ${message.slice(0, 300) || 'no message'}.`,
  });
}
