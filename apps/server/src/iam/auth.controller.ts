import { Controller, Inject, Req, Res } from '@nestjs/common';
import {
  API_BASE_PATH,
  SESSION_COOKIE_NAME,
  routes,
  type LoginResponse,
  type SessionAppConfig,
  type SessionResponse,
} from '@salesforce/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Contract, ApiRoute, type RequestContract } from '../http/route.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { AccountPhotoService } from './account-photo.service.js';
import { AppConfigService } from './app-config.service.js';
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
    @Inject(AccountPhotoService) private readonly photos: AccountPhotoService,
    @Inject(AppConfigService) private readonly appConfig: AppConfigService,
  ) {}

  @ApiRoute(routes.login)
  async login(
    @Contract() contract: RequestContract<typeof routes.login>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const client = contract.body.client;
    const { token, user } = await this.auth.login(contract.body, {
      ...metaOf(request),
      ...(client === undefined ? {} : { client }),
    });
    void reply.header(
      'set-cookie',
      serializeSessionCookie(token, user.sessionExpiresAt, this.clock(), { secure: this.config.secureCookies }),
    );
    return this.withAppConfig(await this.withPhoto(this.auth.toSessionBody(user)));
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
    return this.withAppConfig(await this.withPhoto(this.auth.toSessionBody(resolved.user)));
  }

  /** Additive: the app parameters of the Force configuration (days without sync, default price table). */
  private async withAppConfig(session: LoginResponse): Promise<LoginResponse> {
    return { ...session, appConfig: await this.appConfig.get() };
  }

  /** Additive: the version of the account's profile photo (cache key of GET /me/photo), null when there is none. */
  private async withPhoto(session: LoginResponse): Promise<LoginResponse> {
    return { ...session, account: { ...session.account, photoVersion: await this.photos.versionOf(session.account.id) } };
  }

  @ApiRoute(routes.getAppConfig)
  appConfigRoute(): Promise<SessionAppConfig> {
    return this.appConfig.get();
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
