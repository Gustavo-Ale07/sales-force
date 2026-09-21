import { Controller, Get, Module, Post, type Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { routes, type RouteDefinition } from '@salesforce/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { ApiModule } from '../../src/api/api.module.js';
import { createApiApp, type CreateApiAppOptions } from '../../src/api/create-app.js';
import { ApiRoute } from '../../src/http/route.js';
import type { AuthConfig } from '../../src/iam/auth-config.js';
import { createLogger } from '../../src/observability/logger.js';
import { TEST_ORIGIN, TestClock, testAuthConfig, sessionCookieOf } from './auth.js';
import { captureLogs, createMigratedDatabase, type MigratedDatabase, type TestPostgres } from './postgres.js';

/** A registry-shaped `session` route that exists only in tests and is deliberately absent from ROUTE_POLICY. */
export const UNGRANTED_PROBE_ROUTE: RouteDefinition = {
  ...routes.listSellers,
  operationId: 'probeUngranted',
  path: '/probe-ungranted',
};

/**
 * Two handlers for the default-deny tests: one that is not bound to the contract registry at all, and
 * one bound to a `session` route of the registry that has no grant in the policy table.
 */
@Controller('/api/v1')
class ProbeController {
  @Get('probe-unbound')
  unboundRead(): { reached: true } {
    return { reached: true };
  }

  @Post('probe-unbound')
  unboundWrite(): { reached: true } {
    return { reached: true };
  }

  // A `session` route whose operation has no entry in ROUTE_POLICY (every real route has one by now).
  @ApiRoute(UNGRANTED_PROBE_ROUTE)
  ungranted(): never {
    throw new Error('the policy must have denied this before the handler runs');
  }
}

/**
 * A controller with one handler per given route of the registry, for routes whose real handler does
 * not exist yet. Reaching a stub is a test failure (the handler throws): the guard must have decided
 * first. It lets the authorization matrix exercise the real guard and policy on every route today.
 */
export function stubControllerFor(routeList: readonly RouteDefinition[]): Type<unknown> {
  @Controller('/api/v1')
  class StubController {}
  for (const route of routeList) {
    const key = `stub_${route.operationId}`;
    Object.defineProperty(StubController.prototype, key, {
      value: () => {
        throw new Error(`stub of ${route.operationId} reached: the access guard let the request through`);
      },
      writable: true,
      configurable: true,
    });
    const descriptor = Object.getOwnPropertyDescriptor(StubController.prototype, key);
    if (descriptor === undefined) throw new Error('stub descriptor missing');
    ApiRoute(route)(StubController.prototype, key, descriptor);
    Object.defineProperty(StubController.prototype, key, descriptor);
  }
  return StubController;
}

export interface AuthApp {
  readonly app: NestFastifyApplication;
  readonly database: MigratedDatabase;
  readonly clock: TestClock;
  readonly capture: ReturnType<typeof captureLogs>;
  readonly auth: AuthConfig;
}

export interface AuthAppOptions {
  readonly authOverrides?: Partial<AuthConfig>;
  readonly trustProxy?: CreateApiAppOptions['trustProxy'];
  /** Registry routes to serve with throwing stubs (see `stubControllerFor`). */
  readonly stubRoutes?: readonly RouteDefinition[];
  /** Adds the probe controller (unbound handler, ungranted session route). */
  readonly withProbes?: boolean;
  readonly database?: MigratedDatabase;
}

/** The API with the real identity module over a fresh migrated database and a hand-driven clock. */
export async function startAuthApp(
  postgres: TestPostgres,
  closers: (() => Promise<unknown>)[],
  options: AuthAppOptions = {},
): Promise<AuthApp> {
  const database = options.database ?? (await createMigratedDatabase(postgres));
  if (options.database === undefined) closers.push(() => database.handle.close());
  const clock = new TestClock();
  const capture = captureLogs();
  const logger = createLogger({ level: 'info', service: 'api', destination: capture.stream });
  const auth = testAuthConfig(options.authOverrides);

  let rootModule: CreateApiAppOptions['rootModule'];
  const extraControllers: Type<unknown>[] = [
    ...(options.withProbes === true ? [ProbeController] : []),
    ...(options.stubRoutes === undefined ? [] : [stubControllerFor(options.stubRoutes)]),
  ];
  if (extraControllers.length > 0) {
    @Module({
      imports: [ApiModule.register({ logger, db: database.handle, clock: clock.fn }, auth)],
      controllers: extraControllers,
    })
    class ProbedApiModule {}
    rootModule = ProbedApiModule;
  }

  const app = await createApiApp({
    logger,
    db: database.handle,
    clock: clock.fn,
    auth,
    ...(options.trustProxy === undefined ? {} : { trustProxy: options.trustProxy }),
    ...(rootModule === undefined ? {} : { rootModule }),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  closers.push(() => app.close());
  return { app, database, clock, capture, auth };
}

export const JSON_HEADERS = { 'content-type': 'application/json', origin: TEST_ORIGIN } as const;

export function login(
  { app }: Pick<AuthApp, 'app'>,
  email: string,
  password: string,
  extra: { headers?: Record<string, string>; remoteAddress?: string } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...JSON_HEADERS, ...extra.headers },
    payload: JSON.stringify({ email, password }),
    ...(extra.remoteAddress === undefined ? {} : { remoteAddress: extra.remoteAddress }),
  });
}

/** Logs in and returns the `cookie` header value for follow-up requests. */
export async function loginCookie(app: Pick<AuthApp, 'app'>, email: string, password: string): Promise<string> {
  const response = await login(app, email, password);
  if (response.statusCode !== 200) throw new Error(`login failed with ${response.statusCode}: ${response.body.slice(0, 300)}`);
  return sessionCookieOf(response);
}
