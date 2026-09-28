import type { ApiSchema } from "@salesforce/contracts/client";
import { Toaster, TooltipProvider } from "@salesforce/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createWebApiClient } from "../lib/api";
import { createApiAuthClient } from "../lib/api-auth-client";
import { AppServicesProvider } from "../lib/app-context";
import type { AuthClient } from "../lib/auth-client";
import { defaultRuntimeConfig, type RuntimeConfig } from "../lib/runtime-config";
import { createAppRouter } from "../router";
import { account, configuration, orderEntryConfiguration, ready } from "./fixtures";

export interface MockRequest {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
  headers: Headers;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = MockResponse | ((request: MockRequest, params: Record<string, string>) => MockResponse | Promise<MockResponse>);
export type Handlers = Record<string, Handler>;

const API_PREFIX = "/api/v1";

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index] ?? "";
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(actual);
    else if (part !== actual) return null;
  }
  return params;
}

/** In-memory API: a `fetch` answering from handlers keyed `"GET /customers/:code"`, recording every request. */
export function createMockApi(handlers: Handlers) {
  const calls: MockRequest[] = [];
  const fetch = async (input: Request): Promise<Response> => {
    const url = new URL(input.url);
    const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname;
    let body: unknown;
    if (input.method !== "GET" && input.method !== "HEAD") {
      const text = await input.clone().text();
      body = text ? (JSON.parse(text) as unknown) : undefined;
    }
    const record: MockRequest = { method: input.method, path, search: url.searchParams, body, headers: input.headers };
    calls.push(record);
    for (const [key, handler] of Object.entries(handlers)) {
      const [method, pattern] = key.split(" ") as [string, string];
      if (method !== input.method) continue;
      const params = matchPath(pattern, path);
      if (!params) continue;
      const result = typeof handler === "function" ? await handler(record, params) : handler;
      const status = result.status ?? 200;
      return new Response(status === 204 || result.body === undefined ? null : JSON.stringify(result.body), {
        status,
        headers: { "content-type": "application/json", ...result.headers },
      });
    }
    return new Response(JSON.stringify({ code: "not_found", message: `Sem handler de teste para ${input.method} ${path}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

/** Error envelope as the server sends it, with the correlation id in `x-request-id`. */
export function apiError(status: number, code: string, message: string, extra: { requestId?: string; issues?: unknown[]; details?: Record<string, unknown>; headers?: Record<string, string> } = {}): MockResponse {
  const details = extra.issues || extra.details ? { ...extra.details, ...(extra.issues ? { issues: extra.issues } : {}) } : undefined;
  return {
    status,
    body: { code, message, ...(details ? { details } : {}) },
    headers: { ...(extra.requestId ? { "x-request-id": extra.requestId } : {}), ...extra.headers },
  };
}

export const session = (authenticated: boolean, role: ApiSchema<"Account">["role"] = account.role): MockResponse =>
  authenticated
    ? { body: { authenticated: true, authMode: "dev", account: { ...account, role }, expiresAt: "2026-09-21T20:00:00.000Z" } satisfies ApiSchema<"AuthenticatedSession"> }
    : { body: { authenticated: false, authMode: "dev" } satisfies ApiSchema<"AnonymousSession"> };

export interface RenderOptions {
  handlers?: Handlers;
  /** Signed in by default; `false` renders an anonymous visitor. */
  signedIn?: boolean;
  /** Role of the signed-in account; a seller by default. */
  role?: ApiSchema<"Account">["role"];
  config?: Partial<RuntimeConfig>;
  /** Replaces the API-backed auth client (only for tests that need a scripted one). */
  authClient?: AuthClient;
  /** Cache retention of the test query client (0 by default: nothing survives without an observer). */
  gcTime?: number;
  /** Runs before the first render, e.g. to prime the query cache. */
  prepare?: (queryClient: QueryClient) => void;
}

export function renderApp(initialPath: string, options: RenderOptions = {}) {
  const { handlers = {}, signedIn = true, role, config, authClient: customAuth, gcTime = 0, prepare } = options;
  const mock = createMockApi({
    "GET /auth/session": session(signedIn, role),
    "GET /ready": { body: ready },
    "GET /configuration": { body: configuration },
    "GET /order-entry/configuration": { body: orderEntryConfiguration },
    ...handlers,
  });
  const api = createWebApiClient({ fetch: mock.fetch, origin: "http://localhost" });
  const authClient = customAuth ?? createApiAuthClient(api);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime }, mutations: { retry: false } } });
  prepare?.(queryClient);
  const router = createAppRouter({ queryClient, authClient }, { history: createMemoryHistory({ initialEntries: [initialPath] }) });
  const utils = render(
    <AppServicesProvider value={{ config: { ...defaultRuntimeConfig, ...config }, authClient, api }}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppServicesProvider>,
  );
  return { ...utils, router, queryClient, calls: mock.calls, user: userEvent.setup() };
}

export const callsTo = (calls: MockRequest[], method: string, path: string) => calls.filter((call) => call.method === method && call.path === path);

/** Opens the user menu from the keyboard (Enter on the trigger): also proves the menu is keyboard reachable. */
export async function openUserMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", { name: /Menu do usuário/ });
  trigger.focus();
  await user.keyboard("{Enter}");
}
