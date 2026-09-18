import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './generated/api-types.js';

/**
 * Typed API client for the web app. Types come from the generated OpenAPI (no hand-written DTOs).
 * `baseUrl` is the API root, e.g. `/api/v1`. Cookies (HttpOnly session) are sent same-origin.
 */
export function createApiClient(baseUrl: string, options: Omit<ClientOptions, 'baseUrl'> = {}) {
  return createClient<paths>({ credentials: 'same-origin', ...options, baseUrl });
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type ApiPaths = paths;
export type ApiComponents = components;
/** Schema by component id, e.g. `ApiSchema<'CustomerListItem'>`. */
export type ApiSchema<K extends keyof components['schemas']> = components['schemas'][K];
