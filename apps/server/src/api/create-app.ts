import type { DynamicModule, Type } from '@nestjs/common';
import { LogController } from 'fastify';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiExceptionFilter } from '../http/error-filter.js';
import type { Logger } from '../observability/logger.js';
import { NestPinoLogger } from '../observability/nest-logger.js';
import { REQUEST_ID_HEADER, resolveRequestId } from '../observability/request-context.js';
import type { InfrastructureDeps } from '../platform/infrastructure.module.js';
import { ApiModule } from './api.module.js';

export interface CreateApiAppOptions extends InfrastructureDeps {
  /** Test seam: replaces the root module (default: `ApiModule`). */
  readonly rootModule?: Type<unknown> | DynamicModule;
  readonly logger: Logger;
}

/** Request bodies above this size are rejected (no upload endpoint exists in Stage 1a). */
export const API_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Builds the API application (Nest on Fastify) without listening: the entry point calls `listen`,
 * tests call `inject`. Correlation: the caller's `x-request-id` is accepted when well formed
 * (otherwise one is generated), returned on every response, and present in every log line and error
 * body of the request.
 */
export async function createApiApp(options: CreateApiAppOptions): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    loggerInstance: options.logger,
    // The header is read by `resolveRequestId`, which validates it (log injection, size).
    requestIdHeader: false,
    // One field name for the correlation id in every log line (same as the log context).
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    genReqId: (request: { headers: Record<string, string | string[] | undefined> }) => resolveRequestId(request.headers[REQUEST_ID_HEADER]),
    bodyLimit: API_BODY_LIMIT_BYTES,
  });

  // Hooks must be registered before Nest registers the routes (at `init`).
  adapter.getInstance().addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  const app = await NestFactory.create<NestFastifyApplication>(options.rootModule ?? ApiModule.register(options), adapter, {
    logger: new NestPinoLogger(options.logger),
    abortOnError: false,
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  return app;
}
