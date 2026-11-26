/**
 * External CNPJ sources (public company registry). Only the 14 CNPJ digits ever leave the server: no customer, seller or other
 * data is part of a request. Failure of a source is never an error for the user (the service treats it as "not found").
 * Primary: BrasilAPI. Alternative: publica.cnpj.ws (public, no key, same data from the Receita Federal registry).
 */
import { readBoundedText, type BoundedResponse, type FetchLike } from './postal-code.source.js';

/** A company record is a few KB; 64 KB is a generous ceiling. */
const MAX_CNPJ_BODY_BYTES = 64 * 1024;

export interface ExternalCompany {
  readonly legalName: string;
  readonly tradeName: string | null;
  /** 8 digits when present. */
  readonly postalCode: string | null;
  readonly street: string | null;
  readonly number: string | null;
  readonly complement: string | null;
  readonly neighborhood: string | null;
  readonly city: string | null;
  readonly uf: string | null;
  readonly phone: string | null;
  readonly email: string | null;
}

export type CnpjSourceName = 'brasilapi' | 'cnpjws';

export interface CnpjSource {
  readonly name: CnpjSourceName;
  /** `null` = the source answered and does not know the CNPJ. Throws when unreachable, slow or garbled. */
  lookup(cnpj: string, signal: AbortSignal): Promise<ExternalCompany | null>;
}

async function readJson(response: BoundedResponse, label: string): Promise<Record<string, unknown>> {
  const raw = await readBoundedText(response, label, MAX_CNPJ_BODY_BYTES);
  const body = JSON.parse(raw) as unknown;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error(`${label}: unexpected body`);
  return body as Record<string, unknown>;
}

const text = (value: unknown): string | null => {
  const raw = typeof value === 'number' ? String(value) : value;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
};

const digits = (value: unknown): string | null => {
  const raw = text(value);
  const only = raw === null ? '' : raw.replace(/\D/g, '');
  return only === '' ? null : only;
};

function postalCodeOf(value: unknown): string | null {
  const only = digits(value);
  return only !== null && only.length === 8 ? only : null;
}

/** Brazilian landline/mobile: 10 or 11 digits with the area code; anything else is dropped (never guessed). */
function phoneOf(...values: unknown[]): string | null {
  for (const value of values) {
    const only = digits(value);
    if (only !== null && (only.length === 10 || only.length === 11)) return only;
  }
  return null;
}

function emailOf(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.toLowerCase() : null;
}

function ufOf(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && raw.length === 2 ? raw.toUpperCase() : null;
}

export class BrasilApiCnpjSource implements CnpjSource {
  readonly name = 'brasilapi' as const;
  constructor(private readonly fetchFn: FetchLike = fetch as unknown as FetchLike) {}

  async lookup(cnpj: string, signal: AbortSignal): Promise<ExternalCompany | null> {
    const response = await this.fetchFn(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) throw new Error(`brasilapi status ${response.status}`);
    const body = await readJson(response, 'brasilapi');
    const legalName = text(body['razao_social']);
    if (legalName === null) return null;
    return {
      legalName,
      tradeName: text(body['nome_fantasia']),
      postalCode: postalCodeOf(body['cep']),
      street: text(body['logradouro']),
      number: text(body['numero']),
      complement: text(body['complemento']),
      neighborhood: text(body['bairro']),
      city: text(body['municipio']),
      uf: ufOf(body['uf']),
      phone: phoneOf(body['ddd_telefone_1'], body['ddd_telefone_2']),
      email: emailOf(body['email']),
    };
  }
}

export class CnpjWsSource implements CnpjSource {
  readonly name = 'cnpjws' as const;
  constructor(private readonly fetchFn: FetchLike = fetch as unknown as FetchLike) {}

  async lookup(cnpj: string, signal: AbortSignal): Promise<ExternalCompany | null> {
    const response = await this.fetchFn(`https://publica.cnpj.ws/cnpj/${cnpj}`, { signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) throw new Error(`cnpjws status ${response.status}`);
    const body = await readJson(response, 'cnpjws');
    const legalName = text(body['razao_social']);
    const est = body['estabelecimento'];
    if (legalName === null || est === null || typeof est !== 'object') return null;
    const e = est as Record<string, unknown>;
    const cityObj = e['cidade'] as Record<string, unknown> | null | undefined;
    const stateObj = e['estado'] as Record<string, unknown> | null | undefined;
    const street = [text(e['tipo_logradouro']), text(e['logradouro'])].filter((p) => p !== null).join(' ');
    const phone1 = text(e['ddd1']) !== null && text(e['telefone1']) !== null ? `${text(e['ddd1'])}${text(e['telefone1'])}` : null;
    const phone2 = text(e['ddd2']) !== null && text(e['telefone2']) !== null ? `${text(e['ddd2'])}${text(e['telefone2'])}` : null;
    return {
      legalName,
      tradeName: text(e['nome_fantasia']),
      postalCode: postalCodeOf(e['cep']),
      street: street === '' ? null : street,
      number: text(e['numero']),
      complement: text(e['complemento']),
      neighborhood: text(e['bairro']),
      city: text(cityObj?.['nome']),
      uf: ufOf(stateObj?.['sigla'] ?? e['estado_sigla']),
      phone: phoneOf(phone1, phone2),
      email: emailOf(e['email']),
    };
  }
}
