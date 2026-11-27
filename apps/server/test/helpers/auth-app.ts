import type { ObjectStore } from '../../src/media/object-store.js';
import { Controller, Get, Module, Post, type Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SESSION_COOKIE_NAME, routes, type DatasetIdentity, type RouteDefinition } from '@salesforce/contracts';
import { SERVER_CODE_HEADER } from '@salesforce/contracts';
import { account, serverCode } from '@salesforce/db';
import type { LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { hashServerCodeSecret } from '../../src/iam/server-code.service.js';
import { SessionRepository } from '../../src/iam/session.repository.js';
import { generateSessionToken, hashSessionToken } from '../../src/iam/session-crypto.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { ApiModule } from '../../src/api/api.module.js';
import { createApiApp, type CreateApiAppOptions } from '../../src/api/create-app.js';
import type { ProductImageSettings, ProductImageSource } from '../../src/catalog/product-image.js';
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

/** Secret of the server code every test app is seeded with; the app's `inject` sends it unless the request names the header itself. */
export const TEST_SERVER_CODE_SECRET = 'k'.repeat(43);
/** Header value that a request sets to be sent WITHOUT a usable code (the harness leaves a present header alone). */
export const NO_SERVER_CODE = '';

/** Seeds the active server code of the test database (idempotent: the table holds a single row). */
export async function seedServerCode(database: MigratedDatabase, now: Date = new Date()): Promise<void> {
  await database.handle.db
    .insert(serverCode)
    .values({ id: uuidv7(now.getTime()), codeHash: hashServerCodeSecret(TEST_SERVER_CODE_SECRET), createdAt: now, rotatedByAccountId: null })
    .onConflictDoNothing();
}

/**
 * Central place where the server code reaches the tests: every `app.inject` carries the seeded code unless the request already sets
 * `x-server-code` (any value, including `NO_SERVER_CODE`). The health probes ignore it, as in production.
 */
export function sendServerCodeByDefault(app: NestFastifyApplication): void {
  app.getHttpAdapter().getInstance().addHook('onRequest', (request, _reply, done) => {
    if (request.headers[SERVER_CODE_HEADER] === undefined) request.headers[SERVER_CODE_HEADER] = TEST_SERVER_CODE_SECRET;
    done();
  });
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
  /** Installation dataset identity (default none). */
  readonly dataset?: DatasetIdentity | null;
  readonly productImageSource?: ProductImageSource;
  readonly productImageSettings?: Partial<ProductImageSettings>;
  /** Object store of the profile photos (default none: the photo routes answer 503). */
  readonly accountPhotoStore?: ObjectStore;
  /** Opens the API-side enqueue of orders for the ERP (default off, as shipped). */
  readonly orderEnqueueEnabled?: boolean;
  /** Opens the customer edit route (default off, as shipped). */
  readonly customerEditEnabled?: boolean;
  /** Opens the customer creation route (default off, as shipped). */
  readonly customerEnqueueEnabled?: boolean;
  /** How long a creation waits for the worker before answering 202 (tests use no wait). */
  readonly customerConfirmWait?: { readonly timeoutMs?: number; readonly pollMs?: number; readonly sleep?: (ms: number) => Promise<void> };
  /** Opens the API-side queueing of the profile photo write to the ERP (default off, as shipped; spike S1.8). */
  readonly profilePhotoErpWriteEnabled?: boolean;
  /** RT-1: open the dedicated LISTEN connection and the SSE route (default off: the route answers 503). */
  readonly eventStreamEnabled?: boolean;
  readonly eventStreamLimits?: { readonly perAccount?: number; readonly total?: number };
}

/** The API with the real identity module over a fresh migrated database and a hand-driven clock. */
export async function startAuthApp(
  postgres: TestPostgres,
  closers: (() => Promise<unknown>)[],
  options: AuthAppOptions = {},
): Promise<AuthApp> {
  const database = options.database ?? (await createMigratedDatabase(postgres));
  if (options.database === undefined) closers.push(() => database.handle.close());
  await seedServerCode(database);
  const clock = new TestClock();
  const capture = captureLogs();
  const logger = createLogger({ level: 'info', service: 'api', destination: capture.stream });
  const auth = testAuthConfig(options.authOverrides);

  const imageDeps = {
    ...(options.accountPhotoStore === undefined ? {} : { accountPhotoStore: options.accountPhotoStore }),
    ...(options.profilePhotoErpWriteEnabled === undefined ? {} : { profilePhotoErpWriteEnabled: options.profilePhotoErpWriteEnabled }),
    ...(options.productImageSource === undefined ? {} : { productImageSource: options.productImageSource }),
    ...(options.productImageSettings === undefined ? {} : { productImageSettings: options.productImageSettings }),
  };
  let rootModule: CreateApiAppOptions['rootModule'];
  const extraControllers: Type<unknown>[] = [
    ...(options.withProbes === true ? [ProbeController] : []),
    ...(options.stubRoutes === undefined ? [] : [stubControllerFor(options.stubRoutes)]),
  ];
  if (extraControllers.length > 0) {
    @Module({
      imports: [ApiModule.register({ logger, db: database.handle, clock: clock.fn, dataset: options.dataset ?? null, orderEnqueueEnabled: options.orderEnqueueEnabled ?? false, customerEditEnabled: options.customerEditEnabled ?? false, customerEnqueueEnabled: options.customerEnqueueEnabled ?? false, ...(options.customerConfirmWait === undefined ? {} : { customerConfirmWait: options.customerConfirmWait }), ...imageDeps }, auth)],
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
    dataset: options.dataset ?? null,
    ...imageDeps,
    ...(options.eventStreamEnabled === undefined ? {} : { eventStreamEnabled: options.eventStreamEnabled }),
    ...(options.eventStreamLimits === undefined ? {} : { eventStreamLimits: options.eventStreamLimits }),
    orderEnqueueEnabled: options.orderEnqueueEnabled ?? false,
    customerEditEnabled: options.customerEditEnabled ?? false,
    customerEnqueueEnabled: options.customerEnqueueEnabled ?? false,
    ...(options.customerConfirmWait === undefined ? {} : { customerConfirmWait: options.customerConfirmWait }),
    ...(options.trustProxy === undefined ? {} : { trustProxy: options.trustProxy }),
    ...(rootModule === undefined ? {} : { rootModule }),
  });
  sendServerCodeByDefault(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  closers.push(() => app.close());
  return { app, database, clock, capture, auth };
}

export const JSON_HEADERS = { 'content-type': 'application/json', origin: TEST_ORIGIN } as const;

export function login(
  { app }: Pick<AuthApp, 'app'>,
  username: string,
  password: string,
  extra: { headers?: Record<string, string>; remoteAddress?: string; client?: 'web' | 'app' } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...JSON_HEADERS, ...extra.headers },
    payload: JSON.stringify({ username, password, ...(extra.client === undefined ? {} : { client: extra.client }), }),
    ...(extra.remoteAddress === undefined ? {} : { remoteAddress: extra.remoteAddress }),
  });
}

/**
 * Logs in and returns the `cookie` header value for follow-up requests. AUTH-6: a `seller` never signs in with a local password, so
 * for a local seller account (what the fixtures create) the session is opened directly, the way a completed Sankhya login would
 * leave it. Every other profile goes through the real login endpoint. Tests of the login rules themselves use `login`.
 */
export async function loginCookie(
  ctx: Pick<AuthApp, 'app'> & Partial<Pick<AuthApp, 'database' | 'clock'>>,
  username: string,
  password: string,
): Promise<string> {
  if (ctx.database !== undefined) {
    const db = ctx.database.handle.db;
    const [row] = await db.select({ id: account.id, role: account.role }).from(account).where(sql`lower(${account.email}) = ${username.toLowerCase()}`);
    if (row?.role === 'seller') {
      // A seller session is valid only for an account linked to a directory user (AUTH-6): link the fixture the way a Sankhya login would.
      await db.update(account).set({ externalUserId: sql`coalesce(${account.externalUserId}, 'test-ext-' || ${account.id}::text)` }).where(sql`${account.id} = ${row.id}`);
      return openSessionCookie(ctx.database, row.id, ctx.clock?.fn() ?? new Date());
    }
  }
  const response = await login(ctx, username, password);
  if (response.statusCode !== 200) throw new Error(`login failed with ${response.statusCode}: ${response.body.slice(0, 300)}`);
  return sessionCookieOf(response);
}

/** Inserts a live session for the account (test fixture only) and returns the cookie pair. */
export async function openSessionCookie(database: MigratedDatabase, accountId: string, now: Date): Promise<string> {
  const token = generateSessionToken();
  await new SessionRepository(database.handle.db).create({
    id: uuidv7(now.getTime()),
    accountId,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}
