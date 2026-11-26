/**
 * Address text rules shared by the postal-code lookup, the mirror match and the ERP registry creation.
 * Pure and deterministic (P-14): no infrastructure.
 */

/** Comparison key of an address name: no accents, uppercase, single spaces. "São João" and "SAO  JOAO" are the same name. */
export function normalizeAddressName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The ERP neighborhood and street names are varchar(60). */
export const REGISTRY_NAME_LIMIT = 60;
/** Characters a registry name may carry once normalized (they reach SQL text: anything else is refused, never escaped-and-hoped). */
const REGISTRY_SAFE_NAME = /^[A-Z0-9 .,\-/ºª()&]+$/;

export type RegistryNameProblem = 'required' | 'too_long' | 'invalid';

/** What is wrong with an already normalized neighborhood/street name (without the street type), or `null` when it is acceptable. */
export function registryNameProblem(normalizedName: string): RegistryNameProblem | null {
  if (normalizedName === '') return 'required';
  if (normalizedName.length > REGISTRY_NAME_LIMIT) return 'too_long';
  if (!REGISTRY_SAFE_NAME.test(normalizedName)) return 'invalid';
  return null;
}

/** Street types written in the ERP `TIPO` column (varchar 8); the abbreviations a person types map to the full word. */
const STREET_TYPES: Readonly<Record<string, string>> = {
  RUA: 'RUA',
  R: 'RUA',
  AVENIDA: 'AVENIDA',
  AV: 'AVENIDA',
  ALAMEDA: 'ALAMEDA',
  AL: 'ALAMEDA',
  TRAVESSA: 'TRAVESSA',
  TV: 'TRAVESSA',
  RODOVIA: 'RODOVIA',
  ROD: 'RODOVIA',
  ESTRADA: 'ESTRADA',
  EST: 'ESTRADA',
  PRACA: 'PRACA',
  PC: 'PRACA',
  LARGO: 'LARGO',
  VIA: 'VIA',
  BECO: 'BECO',
  VIELA: 'VIELA',
};

export interface StreetNameParts {
  /** ERP street type (`TIPO`), uppercase, `null` when the text starts with no known type. */
  readonly kind: string | null;
  /** The name without the type, uppercase and without accents; never empty. */
  readonly name: string;
}

/** The single row among `rows` for which `test` holds; `null` when none or more than one (an ambiguous match is never picked). */
function onlyMatch<T>(rows: readonly T[], test: (row: T) => boolean): T | null {
  let found: T | null = null;
  for (const row of rows) {
    if (!test(row)) continue;
    if (found !== null) return null;
    found = row;
  }
  return found;
}

export interface CityMatchInput {
  readonly name: string;
  /** 2-letter state. */
  readonly uf: string;
  /** 7-digit IBGE municipality code when the source has it. */
  readonly ibge: string | null;
}

/** ERP city for a postal-code answer: IBGE + UF first, else normalized name + UF. Never crosses states; ambiguous = `null`. */
export function matchCity<C extends { name: string; uf: string; ibge: string | null }>(cities: readonly C[], input: CityMatchInput): C | null {
  const uf = input.uf.trim().toUpperCase();
  const sameState = cities.filter((c) => c.uf.trim().toUpperCase() === uf);
  if (input.ibge !== null && input.ibge.trim() !== '') {
    const byIbge = onlyMatch(sameState, (c) => c.ibge !== null && c.ibge.trim() === input.ibge?.trim());
    if (byIbge !== null) return byIbge;
  }
  const key = normalizeAddressName(input.name);
  return onlyMatch(sameState, (c) => normalizeAddressName(c.name) === key);
}

export function matchNeighborhood<N extends { name: string }>(rows: readonly N[], name: string): N | null {
  const key = normalizeAddressName(name);
  return key === '' ? null : onlyMatch(rows, (n) => normalizeAddressName(n.name) === key);
}

/** Street by type + name; a registry row without type also matches the whole text. */
export function matchStreet<S extends { name: string; kind: string | null }>(rows: readonly S[], text: string): S | null {
  const whole = normalizeAddressName(text);
  if (whole === '') return null;
  const { kind, name } = splitStreetName(text);
  return onlyMatch(rows, (s) => {
    const rowName = normalizeAddressName(s.name);
    const rowKind = s.kind === null ? null : normalizeAddressName(s.kind);
    if (rowKind === null || rowKind === '') return rowName === whole;
    return rowKind === kind && rowName === name;
  });
}

/** "Rua das Flores" ->{ kind: 'RUA', name: 'DAS FLORES' }. Never invents a type: an unknown first word stays in the name. */
export function splitStreetName(text: string): StreetNameParts {
  const normalized = normalizeAddressName(text);
  const [first = '', ...rest] = normalized.split(' ');
  const kind = STREET_TYPES[first.replace(/\.$/, '')];
  const name = rest.join(' ').trim();
  if (kind === undefined || name === '') return { kind: null, name: normalized };
  return { kind, name };
}
