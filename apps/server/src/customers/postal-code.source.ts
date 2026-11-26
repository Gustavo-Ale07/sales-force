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

export interface BoundedResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  readonly headers?: { get(name: string): string | null };
  readonly body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
}

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string>; redirect?: 'error' },
) => Promise<BoundedResponse>;

/** A CEP answer is a few hundred bytes; anything beyond this is refused before it is parsed. */
export const MAX_BODY_BYTES = 16 * 1024;

/** Reads the body with a hard byte ceiling: Content-Length is checked first, then the stream is cut at the ceiling. */
export async function readBoundedText(response: BoundedResponse, label: string, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(response.headers?.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${label}: body too large`);
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const raw = await response.text();
    if (raw.length > maxBytes) throw new Error(`${label}: body too large`);
    return raw;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${label}: body too large`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(response: BoundedResponse, label: string): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, label)) as unknown;
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
    const response = await this.fetchFn(`https://viacep.com.br/ws/${cep}/json/`, { signal, redirect: 'error', headers: { accept: 'application/json' } });
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
    const response = await this.fetchFn(`https://brasilapi.com.br/api/cep/v1/${cep}`, { signal, redirect: 'error', headers: { accept: 'application/json' } });
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
