import { isValidCnpj, isValidCpf, normalizeTaxDocument, rejectedCustomerEditFields } from '@salesforce/domain';
import { SankhyaGatewayError, classifyHttpFailure } from '../errors.js';
import { isValidOriginField } from './order-write-config.js';
import type { PartnerWriteRequest } from './partner-contract.js';

/**
 * THE single mapping module of the partner (TGFPAR) write: request -> Sankhya wire, response -> result, column limits,
 * pre-send validation and ERP error classification (D-AP / D-AQ / D-AR; SNK-4, SNK-5, SNK-6).
 *
 * Everything that is NOT in `docs/sankhya-spike.md` is marked `NEEDS VALIDATION` below and is meant to be corrected in
 * ONE place by the Sandbox test (customer-write plan T1-T9) without touching the gateway:
 *   - the SERVICE (`CRUDServiceProvider.saveRecord`, entity `Parceiro`) and the request/response SHAPE: taken from the public
 *     developer documentation, never observed in the Sandbox (spike F-04 only validated `loadRecords` and `executeQuery`);
 *   - the column names TELEFONE, EMAIL, OBSERVACOES, COMPLEMENTO (spike names TELEFONE, EMAIL, CODEND, NUMEND, CODBAI,
 *     CODCID, CEP, CODVEND, CODTAB, IDENTINSCESTAD, CLASSIFICMS, TIPPESSOA, CGC_CPF, NOMEPARC, RAZAOSOCIAL; OBSERVACOES and
 *     COMPLEMENTO are NOT in the spike);
 *   - the response (primary key location) and the error text of a refusal, including whether `statusMessage` is base64;
 *   - contacts (`TGFCTT`) and more than one address: no write mapping exists, so they are refused, never guessed;
 *   - the city (`CODCID`): the request has no city code, so it is not sent (the ERP default 0 applies; S5 says recent
 *     customers always have it filled: a port change is reported to the owner).
 */
export const PARTNER_SAVE_RECORD_PATH = '/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.saveRecord&outputType=json';
export const PARTNER_SAVE_SERVICE = 'CRUDServiceProvider.saveRecord';
export const PARTNER_ROOT_ENTITY = 'Parceiro';

export const ICMS_CLASSIFICATIONS = ['C', 'I', 'P', 'R', 'T', 'X'] as const;

/**
 * Column limits. `null` = NOT KNOWN (NEEDS VALIDATION, S5): not checked here, the ERP's own refusal is classified. Values with
 * a source: NOMEPARC 100 (S5 report, customer-write plan section 0); origin column VARCHAR2(100) (validated by SELECT, plan B3);
 * IDENTINSCESTAD 16 is the OWNER RULING of 2026-11-13 (up to 16 characters), not a measured column size.
 */
export const PARTNER_LIMITS = {
  NOMEPARC: 100,
  RAZAOSOCIAL: null,
  IDENTINSCESTAD: 16,
  TELEFONE: null,
  EMAIL: null,
  OBSERVACOES: null,
  NUMEND: null,
  COMPLEMENTO: null,
  ORIGIN: 100,
} as const;

/** Columns that must never appear in a partner payload. A defence in depth on top of the explicit allow-list below. */
export const PARTNER_FORBIDDEN_COLUMNS: readonly string[] = [
  'LIMCRED',
  'LIMCREDMENSAL',
  'SENHABT',
  'SENHAACESSO',
  'CODTIPPARC',
  'CODREG',
  'TIPOGERBOLETO',
  'CODPARC',
];

/** Fixed value of TGFPAR.TIPGERBOLCENT written only when a partner is created. */
export const PARTNER_BOLETO_CENTRALS_ON_CREATE = 'I';

/** A request field refused before any call. `field` is the Sales Force field, `column` the Sankhya column. */
export class PartnerFieldError extends SankhyaGatewayError {
  readonly field: string;
  readonly column: string | null;

  constructor(code: string, field: string, column: string | null, message: string) {
    super('validation', { code, message });
    this.name = 'PartnerFieldError';
    this.field = field;
    this.column = column;
  }
}

const ORIGIN_KEY_PATTERN = /^force:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARTNER_ISENTO = 'ISENTO';

function overflow(field: string, column: string, limit: number, actual: number): PartnerFieldError {
  return new PartnerFieldError(
    'partner_field_too_long',
    field,
    column,
    `The field '${field}' (ERP column ${column}) has ${actual} characters and the ERP allows at most ${limit}. Nothing was sent; shorten it (it is never truncated).`,
  );
}

function checkLength(value: string | null, field: string, column: keyof typeof PARTNER_LIMITS): void {
  const limit = PARTNER_LIMITS[column];
  if (value !== null && limit !== null && value.length > limit) throw overflow(field, column, limit, value.length);
}

/** A 13-digit CNPJ lost its leading zero (numeric storage): compare and send it with the zero restored. Other lengths unchanged. */
export function canonicalCompanyDocument(digits: string): string {
  return digits.length === 13 ? `0${digits}` : digits;
}

/** The values a stored `CGC_CPF` may hold for a document: the digits and, for a CNPJ, with or without the leading zero. */
export function documentCandidates(document: string): string[] {
  const digits = normalizeTaxDocument(document);
  const candidates = new Set<string>([digits]);
  if (digits.length === 13) candidates.add(`0${digits}`);
  if (digits.length === 14 && digits.startsWith('0')) candidates.add(digits.slice(1));
  return [...candidates];
}

function positiveInt(value: number | null, field: string): void {
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 2_147_483_647)) {
    throw new PartnerFieldError('partner_invalid_field', field, null, `The field '${field}' must be a positive integer.`);
  }
}

function required(value: string, field: string, column: string): void {
  if (value.trim() === '') {
    throw new PartnerFieldError('partner_required_field', field, column, `The field '${field}' (ERP column ${column}) is required.`);
  }
}

/** Everything that can be refused locally is refused here, before any network call. Returns the canonical document. */
export function validatePartnerRequest(request: PartnerWriteRequest): { document: string; stateRegistration: string | null } {
  if (!isValidOriginField(request.originField)) {
    throw new PartnerFieldError('partner_invalid_origin_field', 'originField', null, 'The origin field name is not valid (dedicated AD_ column, never a Vidya column).');
  }
  if (!ORIGIN_KEY_PATTERN.test(request.originKey)) {
    throw new PartnerFieldError('partner_invalid_origin_key', 'originKey', request.originField, "The origin key must be 'force:<uuid>'.");
  }
  checkLength(request.originKey, 'originKey', 'ORIGIN');

  const digits = normalizeTaxDocument(request.document);
  const document = request.personType === 'company' ? canonicalCompanyDocument(digits) : digits;
  const valid = request.personType === 'company' ? isValidCnpj(document) : isValidCpf(document);
  if (!valid) {
    throw new PartnerFieldError(
      'partner_invalid_document',
      'document',
      'CGC_CPF',
      `The document is not a valid ${request.personType === 'company' ? 'CNPJ' : 'CPF'}.`,
    );
  }

  required(request.name, 'name', 'NOMEPARC');
  const tradeName = request.tradeName !== null && request.tradeName.trim() !== '' ? request.tradeName : null;
  checkLength(tradeName ?? request.name, tradeName === null ? 'name' : 'tradeName', 'NOMEPARC');
  checkLength(request.name, 'name', 'RAZAOSOCIAL');

  if (!(ICMS_CLASSIFICATIONS as readonly string[]).includes(request.icmsClassification)) {
    throw new PartnerFieldError('partner_invalid_classification', 'icmsClassification', 'CLASSIFICMS', `The ICMS classification must be one of ${ICMS_CLASSIFICATIONS.join(', ')}.`);
  }

  // Owner ruling 2026-11-13: a legal person carries the IE (up to 16 characters) or "Isento" (stored ISENTO); an individual has none.
  let stateRegistration: string | null = null;
  const ie = request.stateRegistration === null ? '' : request.stateRegistration.trim();
  if (request.personType === 'individual') {
    if (ie !== '') {
      throw new PartnerFieldError('partner_state_registration_not_allowed', 'stateRegistration', 'IDENTINSCESTAD', 'An individual (CPF) has no state registration.');
    }
  } else {
    required(ie, 'stateRegistration', 'IDENTINSCESTAD');
    stateRegistration = ie.toUpperCase() === PARTNER_ISENTO ? PARTNER_ISENTO : ie;
    checkLength(stateRegistration, 'stateRegistration', 'IDENTINSCESTAD');
  }

  positiveInt(request.sellerCode, 'sellerCode');
  positiveInt(request.priceTableCode, 'priceTableCode');
  checkLength(request.phone, 'phone', 'TELEFONE');
  checkLength(request.email, 'email', 'EMAIL');
  checkLength(request.notes, 'notes', 'OBSERVACOES');

  if (request.addresses.length > 1) {
    throw new PartnerFieldError(
      'partner_multiple_addresses_unsupported',
      'addresses',
      null,
      'Only one address can be written: the ERP source of additional addresses is NEEDS VALIDATION (S5.2). Nothing was sent.',
    );
  }
  for (const address of request.addresses) {
    // The city is mandatory (TGFPAR.CODCID is NOT NULL default 0: a 0 would be a registered customer with no city).
    if (!Number.isInteger(address.cityCode) || address.cityCode < 1 || address.cityCode > 2_147_483_647) {
      throw new PartnerFieldError('partner_required_field', 'addresses.cityCode', 'CODCID', 'The city is required (ERP column CODCID).');
    }
    // Street and neighborhood: 0 = none. Names must already be resolved into codes by the worker before this point.
    for (const [field, code] of [['addresses.streetCode', address.streetCode], ['addresses.neighborhoodCode', address.neighborhoodCode]] as const) {
      if (!Number.isInteger(code) || code < 0 || code > 2_147_483_647) {
        throw new PartnerFieldError('partner_invalid_field', field, null, `The field '${field}' must be 0 (none) or a positive integer.`);
      }
    }
    if (address.postalCode !== null && !/^\d{8}$/.test(address.postalCode)) {
      throw new PartnerFieldError('partner_invalid_field', 'addresses.postalCode', 'CEP', 'The postal code must have 8 digits.');
    }
    checkLength(address.number, 'addresses.number', 'NUMEND');
    checkLength(address.complement, 'addresses.complement', 'COMPLEMENTO');
  }
  return { document, stateRegistration };
}

type Wire = Record<string, { $: string }>;
const value = (text: string | number): { $: string } => ({ $: String(text) });

/**
 * The partner columns of a NEW customer. Born rules (D-AP/D-AQ/D-AR): ATIVO 'S', CLIENTE 'S', BLOQUEAR 'N'; price table and seller
 * come from the request (configuration / the chosen seller). LIMCRED and the other forbidden columns are never produced.
 */
export function buildPartnerLocalFields(request: PartnerWriteRequest): Wire {
  const { document, stateRegistration } = validatePartnerRequest(request);
  const fields: Wire = {
    NOMEPARC: value(request.tradeName !== null && request.tradeName.trim() !== '' ? request.tradeName : request.name),
    RAZAOSOCIAL: value(request.name),
    TIPPESSOA: value(request.personType === 'company' ? 'J' : 'F'),
    CGC_CPF: value(document),
    CLASSIFICMS: value(request.icmsClassification),
    ATIVO: value('S'),
    CLIENTE: value('S'),
    BLOQUEAR: value('N'),
    // Owner order 2026-11-26: boleto generation in the centrals = 'I' (Imprimir), fixed, create only (never in the edit wire).
    // TGFPAR.TIPGERBOLCENT CHAR(1) nullable, values in the Sandbox: NULL / I / A (validated by SELECT 2026-11-26).
    TIPGERBOLCENT: value(PARTNER_BOLETO_CENTRALS_ON_CREATE),
    [request.originField]: value(request.originKey),
  };
  if (stateRegistration !== null) fields['IDENTINSCESTAD'] = value(stateRegistration);
  if (request.sellerCode !== null) fields['CODVEND'] = value(request.sellerCode);
  if (request.priceTableCode !== null) fields['CODTAB'] = value(request.priceTableCode);
  if (request.phone !== null && request.phone !== '') fields['TELEFONE'] = value(request.phone);
  if (request.email !== null && request.email !== '') fields['EMAIL'] = value(request.email);
  if (request.notes !== null && request.notes !== '') fields['OBSERVACOES'] = value(request.notes);
  const address = request.addresses[0];
  if (address !== undefined) {
    fields['CODCID'] = value(address.cityCode);
    if (address.streetCode > 0) fields['CODEND'] = value(address.streetCode);
    if (address.neighborhoodCode > 0) fields['CODBAI'] = value(address.neighborhoodCode);
    if (address.number !== null && address.number !== '') fields['NUMEND'] = value(address.number);
    if (address.complement !== null && address.complement !== '') fields['COMPLEMENTO'] = value(address.complement);
    if (address.postalCode !== null) fields['CEP'] = value(address.postalCode);
  }
  assertNoForbiddenColumn(fields);
  return fields;
}

function assertNoForbiddenColumn(fields: Wire): void {
  for (const name of Object.keys(fields)) {
    if (PARTNER_FORBIDDEN_COLUMNS.includes(name.toUpperCase())) {
      throw new PartnerFieldError('partner_forbidden_column', name, name, `The column ${name} is never written by the Force.`);
    }
  }
}

function saveRecordText(dataRow: Record<string, unknown>): string {
  return JSON.stringify({
    serviceName: PARTNER_SAVE_SERVICE,
    requestBody: {
      dataSet: {
        rootEntity: PARTNER_ROOT_ENTITY,
        includePresentationFields: 'N',
        dataRow,
        entity: { fieldset: { list: 'CODPARC' } },
      },
    },
  });
}

/** Pure and deterministic: same request, same payload. */
export function buildPartnerCreateRequestText(request: PartnerWriteRequest): string {
  return saveRecordText({ localFields: buildPartnerLocalFields(request) });
}

// ---- edit (D-AP): phone, email, contacts, addresses, notes only ------------------------------------

export interface PartnerEditRequest {
  /** The ERP partner code (`CODPARC`). */
  readonly code: number;
  /** Only keys of the allow-list `CUSTOMER_EDITABLE_FIELDS`; any other key is refused before any call. */
  readonly changes: Readonly<Record<string, unknown>>;
}

/** Allow-list validation + mapping. `contacts` and `addresses` have NO write mapping yet (NEEDS VALIDATION, S5.2): refused, not guessed. */
export function buildPartnerEditRequestText(request: PartnerEditRequest): string {
  positiveInt(request.code, 'code');
  const rejected = rejectedCustomerEditFields(request.changes);
  if (rejected.length > 0) {
    throw new PartnerFieldError('partner_edit_field_not_allowed', rejected[0] as string, null, `Fields not editable on an existing customer: ${rejected.join(', ')}. Nothing was sent.`);
  }
  const fields: Wire = {};
  const text = (name: 'phone' | 'email' | 'notes', column: 'TELEFONE' | 'EMAIL' | 'OBSERVACOES'): void => {
    const raw = request.changes[name];
    if (raw === undefined) return;
    if (raw !== null && typeof raw !== 'string') throw new PartnerFieldError('partner_invalid_field', name, column, `The field '${name}' must be text or null.`);
    checkLength(raw, name, column);
    fields[column] = value(raw ?? '');
  };
  text('phone', 'TELEFONE');
  text('email', 'EMAIL');
  text('notes', 'OBSERVACOES');
  for (const unsupported of ['contacts', 'addresses'] as const) {
    if (request.changes[unsupported] !== undefined) {
      throw new PartnerFieldError(
        'partner_edit_unsupported',
        unsupported,
        null,
        `Editing '${unsupported}' has no validated ERP mapping yet (NEEDS VALIDATION, S5.2). Nothing was sent.`,
      );
    }
  }
  if (Object.keys(fields).length === 0) {
    throw new PartnerFieldError('partner_edit_empty', 'changes', null, 'The edit has no change to send.');
  }
  assertNoForbiddenColumn(fields);
  return saveRecordText({ key: { CODPARC: value(request.code) }, localFields: fields });
}

// ---- response ---------------------------------------------------------------------------------

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function dollar(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const inner = input['$'];
  return typeof inner === 'string' || typeof inner === 'number' ? String(inner) : null;
}

/** `statusMessage` may travel base64-encoded (NEEDS VALIDATION); decoded only when the result is clean text. */
function readableMessage(raw: string): string {
  const compact = raw.trim();
  if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(compact) && compact.length % 4 === 0) {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u0008\u000e-\u001f�]/.test(decoded)) return decoded;
  }
  return compact;
}

/** Short, secret-free reason: digit runs of 11+ (CPF/CNPJ) are masked, control characters removed, 300 characters at most. */
export function sanitizeErpReason(raw: string): string {
  return readableMessage(raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\d[\d.\-/]{9,}\d/g, '[documento]')
    .trim()
    .slice(0, 300);
}

function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * A refusal of the ERP is DEFINITIVE (`permanent`, never retried) with the real reason. The text patterns below only choose a
 * stable `code`; unknown refusals stay `erp_refused_partner`. NEEDS VALIDATION: the real refusal texts were never observed.
 */
export function classifyPartnerRefusal(rawMessage: string): SankhyaGatewayError {
  const reason = sanitizeErpReason(rawMessage);
  const folded = foldAccents(reason);
  let code = 'erp_refused_partner';
  if (/(cnpj|cpf|documento)/.test(folded) && /(ja |existe|cadastrad|duplic|repetid)/.test(folded)) code = 'partner_document_duplicate';
  else if (/(obrigatori|deve ser informad|nao pode ser nulo|campo .* informad)/.test(folded)) code = 'partner_required_field';
  return new SankhyaGatewayError('permanent', {
    code,
    message: `The ERP refused the partner${reason === '' ? ' (no message)' : `: ${reason}`}.`,
  });
}

/**
 * Success is HTTP 200 + `status` "1" + the partner key. NEEDS VALIDATION: the key location below follows the public documentation.
 * A success WITHOUT a usable key is `temporary`/ambiguous: the partner MAY exist, the worker re-verifies by origin before any resend.
 */
export function parsePartnerSaveResponse(status: number, body: string, retryAfterMs?: number, requireKey = true): { code: number } {
  if (status !== 200) throw classifyHttpFailure(status, 'ERP partner write', retryAfterMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'saveRecord: the response was not JSON.', cause });
  }
  if (!isRecord(parsed)) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'saveRecord: unexpected response shape.' });
  }
  if (String(parsed['status']) !== '1') {
    throw classifyPartnerRefusal(typeof parsed['statusMessage'] === 'string' ? parsed['statusMessage'] : '');
  }
  if (!requireKey) return { code: 0 };
  const responseBody = parsed['responseBody'];
  const entities = isRecord(responseBody) ? responseBody['entities'] : undefined;
  let entity: unknown = isRecord(entities) ? entities['entity'] : undefined;
  if (Array.isArray(entity) && entity.length === 1) entity = entity[0];
  const key = isRecord(entity) ? dollar(entity['CODPARC']) : null;
  if (key === null || !/^[1-9]\d{0,9}$/.test(key) || Number(key) > 2_147_483_647) {
    throw new SankhyaGatewayError('temporary', {
      code: 'missing_partner_code',
      message: 'saveRecord succeeded without a usable partner code; verify by origin before any resend.',
    });
  }
  return { code: Number(key) };
}
