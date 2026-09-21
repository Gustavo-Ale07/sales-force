import { Controller, Inject, Res } from '@nestjs/common';
import { API_BASE_PATH, routes, type HealthResponse, type ReadyResponse } from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { ApiRoute } from '../http/route.js';
import { ReadinessService } from './readiness.service.js';

@Controller(API_BASE_PATH)
export class HealthController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  /** Liveness: the process is up. Never touches the database or the integration. */
  @ApiRoute(routes.getHealth)
  health(): HealthResponse {
    return { status: 'ok' };
  }

  /** Readiness: 200 when `ready` or `degraded`, 503 when `not_ready`. */
  @ApiRoute(routes.getReady)
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadyResponse> {
    const result = await this.readiness.check();
    if (result.status === 'not_ready') void reply.status(503);
    return result;
  }
}
