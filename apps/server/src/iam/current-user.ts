import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccountRole } from '@salesforce/domain';
import type { FastifyRequest } from 'fastify';
import type { Channel } from './policy.js';

/**
 * The authenticated actor of a request, resolved from the session on every request (security model
 * §3.2): role, status and seller links are read from current data, so a change takes effect on the
 * next request. Never serialized as-is: responses are built from explicit contract DTOs.
 */
export interface CurrentUser {
  readonly accountId: string;
  /** Login identifier (user name). */
  readonly username: string;
  readonly displayName: string;
  readonly role: AccountRole;
  /** Seller codes linked by configuration (CFG-2); never `TSIUSU.CODVEND` by rule. */
  readonly sellerCodes: readonly number[];
  readonly sessionId: string;
  readonly sessionExpiresAt: Date;
  readonly channel: Channel;
}

const CURRENT_USER_PROPERTY = 'sfCurrentUser';

export function setCurrentUser(request: FastifyRequest, user: CurrentUser): void {
  (request as unknown as Record<string, unknown>)[CURRENT_USER_PROPERTY] = user;
}

export function currentUserOf(request: FastifyRequest): CurrentUser | undefined {
  return (request as unknown as Record<string, unknown>)[CURRENT_USER_PROPERTY] as CurrentUser | undefined;
}

/**
 * `@CurrentUser()` parameter. Only routes with `auth: 'session'` have one (the access guard fails
 * closed before the handler otherwise); asking for it on a public route is a programming error.
 */
export const CurrentUserParam = createParamDecorator((_data: unknown, context: ExecutionContext): CurrentUser => {
  const user = currentUserOf(context.switchToHttp().getRequest<FastifyRequest>());
  if (user === undefined) throw new Error('CurrentUser requested on a route without a session');
  return user;
});
