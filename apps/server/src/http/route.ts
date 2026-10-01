import 'reflect-metadata';
import {
  applyDecorators,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  createParamDecorator,
  type CallHandler,
  type ExecutionContext,
  type Type,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import type { RouteDefinition, RouteParams, RouteQuery, RouteBody } from '@salesforce/contracts';
import { toColonPath } from '@salesforce/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { AppError, validationError } from './app-error.js';
import { runWithLogContext } from '../observability/request-context.js';

/**
 * Binds a controller method to an entry of the `packages/contracts` route registry (STACK-4):
 * HTTP method, path, success status, request validation and response validation all come from the
 * registry, so nothing is described twice.
 *
 * - Request: `params`, `query` and `body` are parsed with the route's Zod schemas before the handler
 *   runs; a failure is `validation_failed`. The handler reads the parsed values with `@Contract()`.
 * - Response: the returned value is parsed with the schema of the response status. Zod objects drop
 *   unknown keys, so a field that is not in the contract never leaves the API (P-20). A response
 *   that violates its schema is an `internal_error` (logged with the field paths, never the values).
 * - Correlation: the run is wrapped in the request's log context (every log line carries the
 *   request id; the `x-request-id` response header is set by the adapter hook in `create-app.ts`).
 */

const ROUTE_METADATA = 'sf:route';
const CONTRACT_PROPERTY = 'sfContract';

export interface RequestContract<R extends RouteDefinition> {
  readonly params: RouteParams<R>;
  readonly query: RouteQuery<R>;
  readonly body: RouteBody<R>;
}

const methodDecorators = { get: Get, post: Post, put: Put, delete: Delete } as const;

/** Success status of a route: 201 for a POST that documents it, otherwise the lowest documented 2xx. */
export function successStatusOf(route: RouteDefinition): number {
  const statuses = Object.keys(route.responses)
    .map(Number)
    .filter((status) => status >= 200 && status < 300)
    .sort((a, b) => a - b);
  if (route.method === 'post' && statuses.includes(201)) return 201;
  return statuses[0] ?? 200;
}

export function routeOf(handler: object): RouteDefinition | undefined {
  return Reflect.getMetadata(ROUTE_METADATA, handler) as RouteDefinition | undefined;
}

@Injectable()
export class ContractInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = routeOf(context.getHandler());
    if (route === undefined) return next.handle();

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    return new Observable<unknown>((subscriber) => {
      runWithLogContext({ requestId: request.id }, () => {
        try {
          const contract: Record<string, unknown> = {};
          const { params, query, body } = route.request;
          if (params) {
            const result = params.safeParse(request.params);
            if (!result.success) throw validationError(result.error);
            contract['params'] = result.data;
          }
          if (query) {
            const result = query.safeParse(request.query);
            if (!result.success) throw validationError(result.error);
            contract['query'] = result.data;
          }
          if (body) {
            const result = body.safeParse(request.body);
            if (!result.success) throw validationError(result.error);
            contract['body'] = result.data;
          }
          (request as unknown as Record<string, unknown>)[CONTRACT_PROPERTY] = contract;
        } catch (error) {
          subscriber.error(error);
          return;
        }

        next.handle().subscribe({
          next: (value) => {
            try {
              subscriber.next(validateResponse(route, reply.statusCode, value, request));
            } catch (error) {
              subscriber.error(error);
            }
          },
          error: (error: unknown) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}

function validateResponse(
  route: RouteDefinition,
  status: number,
  value: unknown,
  request: FastifyRequest,
): unknown {
  const declared = route.responses[status];
  if (declared === undefined) {
    request.log.error({ operationId: route.operationId, status }, 'response status is not declared by the contract');
    throw new AppError('internal_error');
  }
  // Binary routes write their own reply (no JSON body to validate).
  if (declared.binary !== undefined) return value;
  if (declared.schema === undefined) return undefined;
  const result = declared.schema.safeParse(value);
  if (!result.success) {
    request.log.error(
      {
        operationId: route.operationId,
        status,
        // Field paths and issue codes only: the values may be personal or restricted data.
        issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`),
      },
      'response violates its contract',
    );
    throw new AppError('internal_error');
  }
  return result.data;
}

/** Route decorator: `@ApiRoute(routes.getHealth)` on a controller method. */
export function ApiRoute(route: RouteDefinition): MethodDecorator {
  const bind = methodDecorators[route.method];
  return applyDecorators(
    bind(toColonPath(route)),
    HttpCode(successStatusOf(route)),
    (_target: object, _key: string | symbol, descriptor: PropertyDescriptor) => {
      Reflect.defineMetadata(ROUTE_METADATA, route, descriptor.value as object);
    },
    UseInterceptors(ContractInterceptor as Type<NestInterceptor>),
  ) as MethodDecorator;
}

/** Parsed `params` / `query` / `body` of the current route (already validated by the registry schemas). */
export const Contract = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  return (request as unknown as Record<string, unknown>)[CONTRACT_PROPERTY];
});
