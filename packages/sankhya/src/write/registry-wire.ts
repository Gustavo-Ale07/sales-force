import { REGISTRY_NAME_LIMIT, normalizeAddressName, registryNameProblem, splitStreetName } from '@salesforce/domain';
import { SankhyaGatewayError, classifyHttpFailure } from '../errors.js';
import { sanitizeErpReason } from './partner-wire.js';

/**
 * Wire format of the address registry creation (TSIBAI neighborhood, TSIEND street), Sandbox only (SNK-3; owner instruction of the
 * session 2026-11-26: the worker creates them while registering the customer).
 *
 * VALIDATED (Sandbox reads, 2026-11-26): tables, column names and sizes (NOMEBAI/NOMEEND varchar 60 uppercase, TIPO varchar 8 as "Rua",
 * DTALTER DATE NOT NULL, TSIBAI.CODREG NOT NULL and 0 in every row, automatic numbering through TGFNUM).
 * NEEDS VALIDATION (the end-to-end Sandbox registration test writes one neighborhood and one street): that the ERP generates CODBAI/CODEND
 * when the key is omitted (numbering is automatic, TGFNUM) and the entity names `Bairro` and `Endereco`. Nothing here guesses a key:
 * when the answer carries none, the row is read back by name.
 */
export const REGISTRY_SAVE_RECORD_PATH = '/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.saveRecord&outputType=json';
const SAVE_SERVICE = 'CRUDServiceProvider.saveRecord';

export type RegistryKind = 'neighborhood' | 'street';

export interface RegistryName {
  /** Normalized (no accents, uppercase) name as stored in the ERP. */
  readonly name: string;
  /** Street type (TIPO) split from the text; always null for a neighborhood. */
  readonly kind: string | null;
}


function registryError(code: string, message: string): SankhyaGatewayError {
  return new SankhyaGatewayError('validation', { code, message });
}

export function neighborhoodName(text: string): RegistryName {
  return checked({ name: normalizeAddressName(text), kind: null }, 'bairro');
}

export function streetName(text: string): RegistryName {
  return checked(splitStreetName(text), 'logradouro');
}

function checked(parts: RegistryName, label: string): RegistryName {
  // The same rule the API applies when the registration is accepted (domain `registryNameProblem`), kept here as the last guard.
  const problem = registryNameProblem(parts.name);
  if (problem === 'required') throw registryError('registry_name_required', `O nome do ${label} é obrigatório.`);
  if (problem === 'too_long') throw registryError('registry_name_too_long', `O nome do ${label} passa de ${REGISTRY_NAME_LIMIT} caracteres.`);
  if (problem === 'invalid') {
    throw registryError('registry_name_invalid', `O nome do ${label} tem caracteres que o ERP não aceita (use letras, números, espaço e . , - / ( ) &).`);
  }
  return parts;
}

const ACCENTS_FROM = 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
const ACCENTS_TO = 'AAAAAEEEEIIIIOOOOOUUUUCN';
const folded = (column: string): string => `UPPER(TRANSLATE(${column}, '${ACCENTS_FROM}', '${ACCENTS_TO}'))`;

export const NEIGHBORHOOD_LOOKUP_COLUMNS = ['CODBAI', 'NOMEBAI'] as const;
export const STREET_LOOKUP_COLUMNS = ['CODEND', 'NOMEEND', 'TIPO'] as const;
/** TSIBAI.CODREG is NOT NULL and every existing neighborhood carries 0 (Sandbox read, 2026-11-26): 0 is the value. */
export const NEIGHBORHOOD_REGION_CODE = 0;

/** Live lookup by name without accents or case (the idempotency check before any creation, SNK-4). */
export function neighborhoodLookupSql(name: RegistryName): string {
  return `SELECT CODBAI, NOMEBAI FROM TSIBAI WHERE CODBAI > 0 AND ${folded('NOMEBAI')} = '${name.name}' ORDER BY CODBAI`;
}

export function streetLookupSql(name: RegistryName): string {
  const kind = name.kind === null ? 'TIPO IS NULL' : `${folded('TIPO')} = '${name.kind}'`;
  return `SELECT CODEND, NOMEEND, TIPO FROM TSIEND WHERE CODEND > 0 AND ${folded('NOMEEND')} = '${name.name}' AND ${kind} ORDER BY CODEND`;
}

/** Date in the format the repo already sends for ERP dates (`dd/MM/yyyy`, as DTNEG), in the database time zone. */
export function erpDate(now: Date, utcOffsetMinutes: number): string {
  const shifted = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const p = (n: number, size = 2): string => String(n).padStart(size, '0');
  return `${p(shifted.getUTCDate())}/${p(shifted.getUTCMonth() + 1)}/${p(shifted.getUTCFullYear(), 4)}`;
}

type Wire = Record<string, { $: string }>;
const value = (text: string | number): { $: string } => ({ $: String(text) });

function saveText(rootEntity: string, key: string, localFields: Wire): string {
  return JSON.stringify({
    serviceName: SAVE_SERVICE,
    requestBody: { dataSet: { rootEntity, includePresentationFields: 'N', dataRow: { localFields }, entity: { fieldset: { list: key } } } },
  });
}

export function buildNeighborhoodCreateText(name: RegistryName, date: string): string {
  return saveText('Bairro', 'CODBAI', { NOMEBAI: value(name.name), CODREG: value(NEIGHBORHOOD_REGION_CODE), DTALTER: value(date) });
}

export function buildStreetCreateText(name: RegistryName, date: string): string {
  const fields: Wire = { NOMEEND: value(name.name), DTALTER: value(date) };
  // The ERP stores the type as 'Rua' (initial capital), the name in uppercase.
  if (name.kind !== null) fields['TIPO'] = value(name.kind.charAt(0) + name.kind.slice(1).toLowerCase());
  return saveText('Endereco', 'CODEND', fields);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/**
 * Success is HTTP 200 + status "1". Returns the generated key, or null when the answer carries none: the caller then reads the row
 * back by name (never guesses a key). A refusal is `permanent` with the ERP reason; a transport failure keeps its classification.
 */
export function parseRegistrySaveResponse(kind: RegistryKind, status: number, body: string, retryAfterMs?: number): number | null {
  if (status !== 200) throw classifyHttpFailure(status, 'ERP address registry write', retryAfterMs);
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
    const reason = sanitizeErpReason(typeof parsed['statusMessage'] === 'string' ? parsed['statusMessage'] : '');
    throw new SankhyaGatewayError('permanent', {
      code: 'erp_refused_address_registry',
      message: `O ERP recusou o cadastro do ${kind === 'neighborhood' ? 'bairro' : 'logradouro'}${reason === '' ? '' : `: ${reason}`}.`,
    });
  }
  const responseBody = parsed['responseBody'];
  const entities = isRecord(responseBody) ? responseBody['entities'] : undefined;
  let entity: unknown = isRecord(entities) ? entities['entity'] : undefined;
  if (Array.isArray(entity) && entity.length === 1) entity = entity[0];
  const field = isRecord(entity) ? entity[kind === 'neighborhood' ? 'CODBAI' : 'CODEND'] : undefined;
  const raw = isRecord(field) ? field['$'] : undefined;
  const key = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null;
  return key !== null && /^[1-9]\d{0,9}$/.test(key) && Number(key) <= 2_147_483_647 ? Number(key) : null;
}
