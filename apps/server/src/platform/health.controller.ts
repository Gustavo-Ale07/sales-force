import { Controller, Inject, Req, Res } from '@nestjs/common';
import { API_BASE_PATH, routes, SESSION_COOKIE_NAME, type HealthResponse, type ReadyResponse } from '@salesforce/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiRoute } from '../http/route.js';
import { readCookie } from '../iam/cookies.js';
import { AuthService } from '../iam/auth.service.js';
import { coarseReadiness, ReadinessService } from './readiness.service.js';

@Controller(API_BASE_PATH)
export class HealthController {
  constructor(
    @Inject(ReadinessService) private readonly readiness: ReadinessService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Liveness: the process is up. Never touches the database or the integration. */
  @ApiRoute(routes.getHealth)
  health(): HealthResponse {
    return { status: 'ok' };
  }

  /**
   * Readiness: 200 when `ready` or `degraded`, 503 when `not_ready`. Public, so an anonymous caller
   * gets only the coarse verdict; the detail (migration counts, failing entities, messages) needs a live
   * session. The check itself is cached and shared (`ReadinessService`).
   */
  @ApiRoute(routes.getReady)
  async ready(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadyResponse> {
    const full = await this.readiness.check();
    if (full.status === 'not_ready') void reply.status(503);
    // Database down: no session can be verified, and the coarse body is all that is safe to say.
    if (full.checks.database === 'fail') return coarseReadiness(full);
    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const signedIn = await this.auth.hasActiveSession(token).catch(() => false);
    return signedIn ? full : coarseReadiness(full);
  }
}
