/**
 * External postal-code (CEP) sources. Only the 8 CEP digits ever leave the server: no customer, seller, document or other
 * data is part of a request. Failure of a source is never an error for the user (the service treats it as "not found").
 */

export interface ExternalAddress {
  readonly street: string | null;
  readonly neighborhood: string | null;
  readonly city: string;
  /** 2-letter state. */
  readonly uf: string;
  /** 7-digit IBGE municipality code when the source returns it. */
  readonly ibge: string | null;
}

export type PostalCodeSourceName = 'viacep' | 'brasilapi';

export interface PostalCodeSource {
  readonly name: PostalCodeSourceName;
  /** `null` = the source answered and does not know the CEP. Throws when the source is unreachable, slow or answers garbage. */
  lookup(cep: string, signal: AbortSignal): Promise<ExternalAddress | null>;
}

export type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** A CEP answer is a few hundred bytes; anything beyond this is refused before it is parsed. */
export const MAX_BODY_BYTES = 16 * 1024;

async function readJson(response: { text(): Promise<string> }, label: string): Promise<unknown> {
  const raw = await response.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error(`${label}: body too large`);
  return JSON.parse(raw) as unknown;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

function ibgeOf(value: unknown): string | null {
  const raw = typeof value === 'number' ? String(value) : text(value);
  return raw !== null && /^\d{7}$/.test(raw) ? raw : null;
}

export class ViaCepSource implements PostalCodeSource {
  readonly name = 'viacep' as const;
  constructor(private readonly fetchFn: FetchLike = fetch as unknown as FetchLike) {}

  async lookup(cep: string, signal: AbortSignal): Promise<ExternalAddress | null> {
    const response = await this.fetchFn(`https://viacep.com.br/ws/${cep}/json/`, { signal, headers: { accept: 'application/json' } });
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) throw new Error(`viacep status ${response.status}`);
    const body = (await readJson(response, 'viacep')) as Record<string, unknown> | null;
    if (body === null || typeof body !== 'object') throw new Error('viacep: unexpected body');
    if (body['erro'] === true || body['erro'] === 'true') return null;
    const city = text(body['localidade']);
    const uf = text(body['uf']);
    if (city === null || uf === null || uf.length !== 2) return null;
    return { street: text(body['logradouro']), neighborhood: text(body['bairro']), city, uf: uf.toUpperCase(), ibge: ibgeOf(body['ibge']) };
  }
}

export class BrasilApiSource implements PostalCodeSource {
  readonly name = 'brasilapi' as const;
  constructor(private readonly fetchFn: FetchLike = fetch as unknown as FetchLike) {}

  async lookup(cep: string, signal: AbortSignal): Promise<ExternalAddress | null> {
    const response = await this.fetchFn(`https://brasilapi.com.br/api/cep/v1/${cep}`, { signal, headers: { accept: 'application/json' } });
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) throw new Error(`brasilapi status ${response.status}`);
    const body = (await readJson(response, 'brasilapi')) as Record<string, unknown> | null;
    if (body === null || typeof body !== 'object') throw new Error('brasilapi: unexpected body');
    const city = text(body['city']);
    const uf = text(body['state']);
    if (city === null || uf === null || uf.length !== 2) return null;
    return { street: text(body['street']), neighborhood: text(body['neighborhood']), city, uf: uf.toUpperCase(), ibge: null };
  }
}
