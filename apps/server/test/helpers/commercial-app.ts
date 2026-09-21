import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_ACCOUNT_EMAILS } from '@salesforce/sankhya';
import type { LightMyRequestResponse } from 'fastify';
import { TEST_ORIGIN, TEST_PASSWORD } from './auth.js';
import { loginCookie, startAuthApp, type AuthApp, type AuthAppOptions } from './auth-app.js';
import { seedDemoAccounts, seedDemoMirror, type DemoAccounts } from './commercial-fixture.js';
import type { TestPostgres } from './postgres.js';

export type Who = 'admin' | 'manager' | 'seller1' | 'seller2';

/** Parsed JSON response body; the tests assert its shape explicitly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface CommercialApp extends AuthApp {
  readonly accounts: DemoAccounts;
  readonly cookies: Readonly<Record<Who, string>>;
  /** JSON request as a demo user; returns status, parsed body and the raw response. */
  call(
    who: Who,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<{ status: number; body: Json; response: LightMyRequestResponse }>;
}

/** The API over a migrated database seeded with the demo mirror, configuration and the four demo accounts. */
export async function startCommercialApp(
  postgres: TestPostgres,
  closers: (() => Promise<unknown>)[],
  options: AuthAppOptions & { seedMirror?: boolean; configuration?: InstallationConfiguration } = {},
): Promise<CommercialApp> {
  const ctx = await startAuthApp(postgres, closers, options);
  if (options.seedMirror !== false) await seedDemoMirror(ctx.database.handle);
  const accounts = await seedDemoAccounts(ctx.database.handle, {
    clock: ctx.clock.fn,
    ...(options.configuration === undefined ? {} : { configuration: options.configuration }),
  });
  const cookies = {} as Record<Who, string>;
  for (const who of ['admin', 'manager', 'seller1', 'seller2'] as const) {
    cookies[who] = await loginCookie(ctx, DEMO_ACCOUNT_EMAILS[who], TEST_PASSWORD);
  }
  return {
    ...ctx,
    accounts,
    cookies,
    async call(who, method, url, body) {
      const response = await ctx.app.inject({
        method,
        url: `/api/v1${url}`,
        headers: {
          origin: TEST_ORIGIN,
          cookie: cookies[who],
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
      const text = response.body;
      return { status: response.statusCode, body: text === '' ? null : JSON.parse(text), response };
    },
  };
}

const RESTRICTED_KEY = /cost|margin|margem|commission|comiss|custo(?!m)/i;

/** Every object key of a JSON value that names restricted data (cost, margin, commission; P-20). */
export function restrictedKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) restrictedKeys(entry, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (RESTRICTED_KEY.test(key)) found.push(key);
      restrictedKeys(entry, found);
    }
  }
  return found;
}
