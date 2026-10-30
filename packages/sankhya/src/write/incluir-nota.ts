import { SankhyaGatewayError, classifyHttpFailure } from '../errors.js';
import type { OrderWriteRequest } from './order-contract.js';

/**
 * CACSP.incluirNota wire format (F-44, VALIDATED (env) for ONE case: one item, TOP 1001, company 1,
 * payment type 11). Every value travels as `{"$": "<text>"}`; empty keys travel as `{}`.
 *
 * NEEDS VALIDATION (spike S3.1, test #1 per SNK-7 D-10): the minimum field set, several items
 * (`item` as a list), `PERCDESC` honoured with `INFORMARPRECO = False` (D-7), the origin field write,
 * the exact value of `IGNOREDESCPROMOQTD`, and `CODPARCTRANSP`.
 */
export const INCLUIR_NOTA_PATH = '/gateway/v1/mgecom/service.sbr?serviceName=CACSP.incluirNota&outputType=json';
/** Movement type of an order ("pedido"), as validated (F-44). */
const MOVEMENT_TYPE_ORDER = 'P';
export const OBSERVATION_MAX_LENGTH = 2000;

type Wire = Record<string, unknown>;
const value = (text: string | number): { $: string } => ({ $: String(text) });
const empty = (): Record<string, never> => ({});

function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) {
    throw new SankhyaGatewayError('validation', { code: 'invalid_order_date', message: 'The order date must be yyyy-MM-dd.' });
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Pure and deterministic: same request, same payload (this is what the dry run stores). */
export function buildIncluirNotaBody(request: OrderWriteRequest): Wire {
  const header: Wire = {
    NUNOTA: empty(),
    CODPARC: value(request.customerCode),
    DTNEG: value(formatDate(request.orderDate)),
    CODTIPOPER: value(request.topCode),
    CODTIPVENDA: value(request.negotiationTypeCode),
    CODEMP: value(request.companyCode),
    TIPMOV: value(MOVEMENT_TYPE_ORDER),
    [request.originField]: value(request.originId),
  };
  if (request.sellerCode !== null) header['CODVEND'] = value(request.sellerCode);
  if (request.carrierCode !== null) header['CODPARCTRANSP'] = value(request.carrierCode);
  if (request.notes !== null && request.notes !== '') header['OBSERVACAO'] = value(request.notes.slice(0, OBSERVATION_MAX_LENGTH));

  const items = request.items.map((item) => {
    const wire: Wire = {
      NUNOTA: empty(),
      // NEEDS VALIDATION: the value is not recorded in F-44 (only the field name).
      IGNOREDESCPROMOQTD: value('true'),
      CODPROD: value(item.productCode),
      QTDNEG: value(item.quantity),
      CODLOCALORIG: value(request.stockLocationCode),
      CODVOL: value(item.unit),
    };
    if (item.discountPercent !== null && Number(item.discountPercent) > 0) wire['PERCDESC'] = value(item.discountPercent);
    return wire;
  });

  return { nota: { cabecalho: header, itens: { INFORMARPRECO: value('False'), item: items } } };
}

export function buildIncluirNotaRequestText(request: OrderWriteRequest): string {
  return JSON.stringify({ serviceName: 'CACSP.incluirNota', requestBody: buildIncluirNotaBody(request) });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function dollar(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const inner = input['$'];
  return typeof inner === 'string' || typeof inner === 'number' ? String(inner) : null;
}

/**
 * Success is HTTP 200 + `status` "1" + `responseBody.pk.NUNOTA.$` (F-44). Any other 200 is an ERP-side
 * refusal. The error body format was NEVER observed (NEEDS VALIDATION), so a refusal is classified
 * conservatively as `validation` (not retried, never resent blindly); the message carries only
 * `statusMessage`, truncated, never the request.
 */
export function parseIncluirNotaResponse(status: number, body: string, retryAfterMs?: number): { erpOrderNumber: number } {
  if (status !== 200) throw classifyHttpFailure(status, 'ERP order write', retryAfterMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'incluirNota: the response was not JSON.', cause });
  }
  if (!isRecord(parsed)) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'incluirNota: unexpected response shape.' });
  }
  if (String(parsed['status']) !== '1') {
    const raw = typeof parsed['statusMessage'] === 'string' ? parsed['statusMessage'] : '';
    throw new SankhyaGatewayError('validation', {
      code: 'erp_refused_order',
      message: `The ERP refused the order: ${raw.slice(0, 300) || 'no message'}.`,
    });
  }
  const responseBody = parsed['responseBody'];
  const pk = isRecord(responseBody) ? responseBody['pk'] : undefined;
  const nunota = isRecord(pk) ? dollar(pk['NUNOTA']) : null;
  if (nunota === null || !/^[1-9]\d{0,9}$/.test(nunota) || Number(nunota) > 2_147_483_647) {
    // Status 1 without a usable key: the order MAY exist. Ambiguous; the worker re-verifies by origin.
    throw new SankhyaGatewayError('temporary', {
      code: 'missing_order_number',
      message: 'incluirNota succeeded without a usable order number; verify by origin before any resend.',
    });
  }
  return { erpOrderNumber: Number(nunota) };
}
