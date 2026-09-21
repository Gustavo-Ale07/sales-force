import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { SESSION_COOKIE_NAME } from '@salesforce/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../http/app-error.js';
import { routeOf } from '../http/route.js';
import { AuthService } from './auth.service.js';
import type { AuthConfig } from './auth-config.js';
import { readCookie, serializeClearedSessionCookie, serializeSessionCookie } from './cookies.js';
import { checkCsrf } from './csrf.js';
import { setCurrentUser } from './current-user.js';
import { AUTH_CONFIG } from './iam-tokens.js';
import { PolicyService } from './policy.service.js';
import { CLOCK, type Clock } from '../platform/tokens.js';

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Global access guard: the one gate every HTTP handler passes through (AUTH-1, AUTH-4).
 *
 * Default deny:
 *  - a handler that is not bound to an entry of the contract registry (`@ApiRoute`) is refused, so a
 *    route can never be reachable without a declared `auth` mode;
 *  - a `session` route requires a live session, a channel the role may use, and an explicit grant in
 *    the policy table; a route without a grant is refused for everyone.
 *
 * CSRF (Origin allow-list, `Sec-Fetch-Site` fallback) is checked before anything else for every
 * state-changing request, public ones (login) included.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const route = routeOf(context.getHandler());
    if (route === undefined) {
      request.log.error({ handler: context.getHandler().name }, 'handler is not bound to the contract registry; denied');
      throw new AppError('forbidden');
    }

    const csrf = checkCsrf(
      {
        method: request.method,
        origin: headerValue(request.headers.origin),
        secFetchSite: headerValue(request.headers['sec-fetch-site']),
      },
      this.config.allowedOrigins,
    );
    if (!csrf.ok) {
      request.log.warn({ operationId: route.operationId, reason: csrf.reason }, 'cross-site request refused');
      throw new AppError('forbidden');
    }

    if (route.auth === 'public') return true;

    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const resolved = await this.auth.resolveSession(token, 'web');
    if (resolved === null) {
      // A cookie that no longer maps to a live session is removed from the browser.
      if (token !== undefined) void reply.header('set-cookie', serializeClearedSessionCookie({ secure: this.config.secureCookies }));
      throw new AppError('unauthenticated');
    }

    const decision = this.policy.authorizeRoute(resolved.user, route.operationId);
    if (!decision.allowed) {
      request.log.warn({ operationId: route.operationId, role: resolved.user.role, reason: decision.reason }, 'access denied by policy');
      throw new AppError('forbidden');
    }

    if (resolved.renewed && token !== undefined) {
      void reply.header(
        'set-cookie',
        serializeSessionCookie(token, resolved.user.sessionExpiresAt, this.clock(), { secure: this.config.secureCookies }),
      );
    }
    setCurrentUser(request, resolved.user);
    return true;
  }
}
