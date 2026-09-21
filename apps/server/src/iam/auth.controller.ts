import { Controller, Inject, Req, Res } from '@nestjs/common';
import {
  API_BASE_PATH,
  SESSION_COOKIE_NAME,
  routes,
  type LoginResponse,
  type SessionResponse,
} from '@salesforce/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Contract, ApiRoute, type RequestContract } from '../http/route.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import type { AuthConfig } from './auth-config.js';
import { readCookie, serializeClearedSessionCookie, serializeSessionCookie } from './cookies.js';
import { CurrentUserParam, type CurrentUser } from './current-user.js';
import { AUTH_CONFIG } from './iam-tokens.js';
import { isChannelAllowed } from './policy.js';

function metaOf(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return { ip: request.ip, userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent, requestId: request.id };
}

/**
 * `/auth/*` (thin: parse, call the service, map to the contract). The token travels only in the
 * `Set-Cookie` header; no body, log line or audit row carries it.
 */
@Controller(API_BASE_PATH)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @ApiRoute(routes.login)
  async login(
    @Contract() contract: RequestContract<typeof routes.login>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const { token, user } = await this.auth.login(contract.body, metaOf(request));
    void reply.header(
      'set-cookie',
      serializeSessionCookie(token, user.sessionExpiresAt, this.clock(), { secure: this.config.secureCookies }),
    );
    return this.auth.toSessionBody(user);
  }

  /** Always 200: `authenticated` says whether a live session exists (the SPA probes it on load). */
  @ApiRoute(routes.getSession)
  async session(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const resolved = await this.auth.resolveSession(token, 'web');
    if (resolved === null || !isChannelAllowed(resolved.user.role, 'web')) {
      if (token !== undefined) void reply.header('set-cookie', serializeClearedSessionCookie({ secure: this.config.secureCookies }));
      return { authenticated: false, authMode: this.config.authMode };
    }
    if (resolved.renewed && token !== undefined) {
      void reply.header(
        'set-cookie',
        serializeSessionCookie(token, resolved.user.sessionExpiresAt, this.clock(), { secure: this.config.secureCookies }),
      );
    }
    return this.auth.toSessionBody(resolved.user);
  }

  @ApiRoute(routes.logout)
  async logout(
    @CurrentUserParam() user: CurrentUser,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(user, metaOf(request));
    void reply.header('set-cookie', serializeClearedSessionCookie({ secure: this.config.secureCookies }));
  }
}
