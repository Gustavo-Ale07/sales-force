import { SERVER_CODE_HEADER, decodeServerCode } from "@salesforce/contracts";
import { resolveApiBaseUrl } from "../config";

/**
 * The server this installation talks to, taken from the server code (owner decision 2026-11-27): the code carries the API address
 * (`a`) and the key (`k`). Only `k` is ever sent (header `X-Server-Code`); the whole code is never sent, logged or shown.
 */
export interface ServerConnection {
  /** API base URL including the API base path. */
  readonly baseUrl: string;
  /** Scheme and host of the API (updates, downloads). */
  readonly origin: string;
  /** The key `k`. Never logged. */
  readonly key: string;
}

/** Where the whole code lives on the device: the platform secure store (see `secure-server-code-store.ts`). */
export interface ServerCodeStore {
  get(): Promise<string | null>;
  set(code: string): Promise<void>;
  clear(): Promise<void>;
}

/** The code read into a connection; `null` when it is not a well-formed code or its address is not acceptable (https outside development). */
export function connectionFromCode(raw: string): ServerConnection | null {
  const parts = decodeServerCode(raw);
  if (parts === null) return null;
  const api = resolveApiBaseUrl(parts.a);
  if (!api.ok) return null;
  return { baseUrl: api.baseUrl, origin: new URL(api.baseUrl).origin, key: parts.k };
}

let current: ServerConnection | null = null;

export function getServerConnection(): ServerConnection | null {
  return current;
}

export function setServerConnection(connection: ServerConnection | null): void {
  current = connection;
}

/** Headers every request to the server carries (empty while there is no code: development fallback and tests). */
export function serverCodeHeaders(): Record<string, string> {
  return current === null ? {} : { [SERVER_CODE_HEADER]: current.key };
}

type Listener = () => void;
const rejectedListeners = new Set<Listener>();

/** The guard answered 401 with an empty body: the code is no longer valid (rotated). The app owner listens and returns to "Adicionar servidor". */
export function onServerCodeRejected(listener: Listener): () => void {
  rejectedListeners.add(listener);
  return () => {
    rejectedListeners.delete(listener);
  };
}

export function notifyServerCodeRejected(): void {
  for (const listener of [...rejectedListeners]) listener();
}

type FetchLike = (input: string | Request, init?: RequestInit) => Promise<Response>;

/** The guard's 401 has no body at all; every other 401 of the API carries the error envelope. */
async function isGuardRejection(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    return (await response.clone().text()) === "";
  } catch {
    return false;
  }
}

/** Wraps any fetch so that every request carries the code's key and a guard 401 is reported. */
export function withServerCode<F extends FetchLike>(base: F): F {
  const wrapped = async (input: string | Request, init?: RequestInit): Promise<Response> => {
    const headers = serverCodeHeaders();
    let response: Response;
    if (typeof input === "string") {
      response = await base(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), ...headers } });
    } else {
      const request = new Request(input, init);
      for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
      response = await base(request);
    }
    if (await isGuardRejection(response)) notifyServerCodeRejected();
    return response;
  };
  return wrapped as F;
}

/** Same as `withServerCode` for the API client, whose fetch takes a ready `Request`. */
export function withServerCodeRequest(
  base: (request: Request) => Promise<Response>,
  options: { readonly reportRejection?: boolean } = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    for (const [name, value] of Object.entries(serverCodeHeaders())) request.headers.set(name, value);
    const response = await base(request);
    if (options.reportRejection !== false && (await isGuardRejection(response))) notifyServerCodeRejected();
    return response;
  };
}

/**
 * Wraps the streaming fetch (`/sync/events`): carries the key, and never reports a rejection, so a 401 of the stream
 * cannot erase the stored code (the ordinary API calls decide that).
 */
export function withServerCodeStream<R>(base: (url: string, init: { headers?: Record<string, string> } & Record<string, unknown>) => R) {
  return (url: string, init: { headers?: Record<string, string> } & Record<string, unknown>): R => base(url, { ...init, headers: { ...init.headers, ...serverCodeHeaders() } });
}

export type CodeCheck = { readonly ok: true; readonly connection: ServerConnection } | { readonly ok: false };

/**
 * "Adicionar servidor": reads the code and asks the server (a light route behind the guard) whether it accepts it. The answer is
 * `ok` only for 204/2xx; a malformed code, a refusal and an unreachable server are all just "not accepted".
 */
export async function checkServerCode(raw: string, fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)): Promise<CodeCheck> {
  const connection = connectionFromCode(raw);
  if (connection === null) return { ok: false };
  try {
    const response = await fetchImpl(`${connection.baseUrl}/server-code/check`, { method: "GET", headers: { [SERVER_CODE_HEADER]: connection.key } });
    return response.ok ? { ok: true, connection } : { ok: false };
  } catch {
    return { ok: false };
  }
}
