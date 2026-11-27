import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { SERVER_CODE_HEADER } from '@salesforce/contracts';
import type { FastifyRequest } from 'fastify';
import { routeOf } from '../http/route.js';
import { ServerCodeRejection } from '../http/server-code-rejection.js';
import { throttleAddress } from './client-address.js';
import { ServerCodeService } from './server-code.service.js';

/** Probes the deploy uses before any client holds a code. Nothing else is exempt. */
export const SERVER_CODE_EXEMPT_OPERATIONS: ReadonlySet<string> = new Set(['getHealth', 'getReady']);

/**
 * Global guard, registered BEFORE the access guard: nothing (login, session renewal, sync, reads) is reached without the right
 * `X-Server-Code` secret. A missing or wrong code is the same bodiless 401; a wrong code from an address that already failed too often gets a bodiless 429 (a correct code always passes).
 * No code configured in the database = everything but the probes is refused.
 */
@Injectable()
export class ServerCodeGuard implements CanActivate {
  constructor(@Inject(ServerCodeService) private readonly codes: ServerCodeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const route = routeOf(context.getHandler());
    if (route !== undefined && SERVER_CODE_EXEMPT_OPERATIONS.has(route.operationId)) return true;

    // The code is verified FIRST: a correct code always passes (a blocked address cannot lock real clients out); the limit counts only failures.
    const raw = request.headers[SERVER_CODE_HEADER];
    const secret = typeof raw === 'string' ? raw : undefined;
    if (await this.codes.verify(secret)) return true;

    const address = throttleAddress(request.ip);
    if (await this.codes.isBlocked(address)) throw new ServerCodeRejection(429);

    await this.codes.recordFailure(address);
    request.log.warn({ reason: 'server_code_rejected' }, 'request refused by the server code guard');
    throw new ServerCodeRejection(401);
  }
}
