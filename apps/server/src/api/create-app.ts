import type { DynamicModule, Type } from '@nestjs/common';
import { LogController } from 'fastify';
import { API_BASE_PATH, routeList, toColonPath } from '@salesforce/contracts';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiExceptionFilter } from '../http/error-filter.js';
import type { AuthConfig } from '../iam/auth-config.js';
import type { Logger } from '../observability/logger.js';
import { NestPinoLogger } from '../observability/nest-logger.js';
import { REQUEST_ID_HEADER, resolveRequestId } from '../observability/request-context.js';
import type { InfrastructureDeps } from '../platform/infrastructure.module.js';
import { ApiModule } from './api.module.js';

/** Reverse-proxy trust: hop count, or proxy addresses/CIDRs. `false` (default) trusts nobody. */
export type TrustProxySetting = boolean | number | readonly string[];

export interface HttpServerLimits {
  /** Time to receive the whole request (Fastify `requestTimeout`). */
  readonly requestTimeoutMs: number;
  /** Idle keep-alive time of a connection; keep it above the reverse proxy's upstream timeout. */
  readonly keepAliveTimeoutMs: number;
  /** Time a socket may stay open without a request (Fastify `connectionTimeout`). */
  readonly connectionTimeoutMs: number;
}

export const DEFAULT_HTTP_LIMITS: HttpServerLimits = {
  requestTimeoutMs: 30_000,
  keepAliveTimeoutMs: 65_000,
  connectionTimeoutMs: 120_000,
};

export interface CreateApiAppOptions extends InfrastructureDeps {
  /** Test seam: replaces the root module (default: `ApiModule`). */
  readonly rootModule?: Type<unknown> | DynamicModule;
  readonly logger: Logger;
  /** Identity module configuration (resolved from the environment by the entry point). */
  readonly auth: AuthConfig;
  /** Default `false`: `request.ip` is the socket address, `X-Forwarded-For` is ignored. Never `true`. */
  readonly trustProxy?: TrustProxySetting;
  readonly limits?: HttpServerLimits;
}

/** A hop count becomes a predicate (hop 0 is the socket peer): only the nearest `hops` addresses are trusted. */
function toFastifyTrustProxy(setting: TrustProxySetting): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof setting === 'number') return (_address, hop) => hop < setting;
  if (typeof setting === 'object') return [...setting];
  return setting;
}

/** Request bodies above this size are rejected (no upload endpoint exists yet). */
export const API_BODY_LIMIT_BYTES = 1024 * 1024;

/** Per-route body caps declared by the contract registry (`maxBodyBytes`), keyed by "METHOD /full/path". */
function routeBodyLimits(): ReadonlyMap<string, number> {
  const limits = new Map<string, number>();
  for (const route of routeList) {
    if (route.maxBodyBytes !== undefined) {
      limits.set(`${route.method.toUpperCase()} ${API_BASE_PATH}${toColonPath(route)}`, route.maxBodyBytes);
    }
  }
  return limits;
}

/**
 * Builds the API application (Nest on Fastify) without listening: the entry point calls `listen`,
 * tests call `inject`. Correlation: the caller's `x-request-id` is accepted when well formed
 * (otherwise one is generated), returned on every response, and present in every log line and error
 * body of the request.
 */
export async function createApiApp(options: CreateApiAppOptions): Promise<NestFastifyApplication> {
  const limits = options.limits ?? DEFAULT_HTTP_LIMITS;
  const trustProxy = options.trustProxy ?? false;
  if (trustProxy === true) throw new Error('trustProxy=true is refused: trust an explicit hop count or proxy list.');

  const adapter = new FastifyAdapter({
    loggerInstance: options.logger,
    // The header is read by `resolveRequestId`, which validates it (log injection, size).
    requestIdHeader: false,
    // One field name for the correlation id in every log line (same as the log context).
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    genReqId: (request: { headers: Record<string, string | string[] | undefined> }) => resolveRequestId(request.headers[REQUEST_ID_HEADER]),
    bodyLimit: API_BODY_LIMIT_BYTES,
    trustProxy: toFastifyTrustProxy(trustProxy),
    requestTimeout: limits.requestTimeoutMs,
    keepAliveTimeout: limits.keepAliveTimeoutMs,
    connectionTimeout: limits.connectionTimeoutMs,
  });

  // Hooks must be registered before Nest registers the routes (at `init`).
  const fastify = adapter.getInstance();
  // A route that declares a smaller body cap than the API-wide limit gets it (checked while the body streams in).
  const bodyLimits = routeBodyLimits();
  const appliedLimits = new Set<string>();
  fastify.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    for (const method of methods) {
      const key = `${method} ${routeOptions.url}`;
      const limit = bodyLimits.get(key);
      if (limit === undefined) continue;
      routeOptions.bodyLimit = limit;
      appliedLimits.add(key);
    }
  });
  // A declared cap that matched no route (a renamed path, a changed prefix) would silently fall back to the API-wide limit.
  // Only the real module registers every contract route, so a test module with a subset is not checked.
  if (options.rootModule === undefined) {
    fastify.addHook('onReady', (done) => {
      const unmatched = [...bodyLimits.keys()].filter((key) => !appliedLimits.has(key));
      done(unmatched.length > 0 ? new Error(`Body limit declared for no registered route: ${unmatched.join(', ')}`) : undefined);
    });
  }
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
  // Every API response: no MIME sniffing, never cached by browsers or intermediaries. Responses can
  // carry session state or scoped business data, and the error and cookie responses must not be stored.
  fastify.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('cache-control', 'no-store');
    done(null, payload);
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    options.rootModule ?? ApiModule.register(options, options.auth),
    adapter,
    {
      logger: new NestPinoLogger(options.logger),
      abortOnError: false,
    },
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  return app;
}
