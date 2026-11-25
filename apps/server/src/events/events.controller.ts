import { Controller, Inject, Req, Res } from '@nestjs/common';
import { API_BASE_PATH, routes, SESSION_COOKIE_NAME } from '@salesforce/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PassThrough } from 'node:stream';
import { AppError } from '../http/app-error.js';
import { ApiRoute } from '../http/route.js';
import { AuthService } from '../iam/auth.service.js';
import { readCookie } from '../iam/cookies.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { EventsHub } from './events.hub.js';

/** Comment-only keep-alive: keeps proxies and the browser from closing an idle stream. Carries no data. */
export const HEARTBEAT_MS = 25_000;
const HEARTBEAT_FRAME = ': keep-alive\n\n';

/**
 * RT-1 `GET /sync/events`: Server-Sent Events carrying content-free pings (`{"topic":"orders"|"reference"}`). Authenticated like every
 * other session route (guard + policy). The stream ends when the session is revoked or expires (checked on every heartbeat, without
 * sliding the expiry) and never carries business data: the client re-reads through the normal, authorized endpoints (P-21).
 */
@Controller(API_BASE_PATH)
export class EventsController {
  constructor(
    @Inject(EventsHub) private readonly hub: EventsHub,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Binary-style route: the handler owns the reply, like the photo routes. */
  @ApiRoute(routes.getSyncEvents)
  async stream(@CurrentUserParam() user: CurrentUser, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const body = new PassThrough();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    let closed = false;
    const held: { heartbeat?: ReturnType<typeof setInterval>; expiry?: ReturnType<typeof setTimeout>; unsubscribe?: () => void } = {};

    const close = (): void => {
      if (closed) return;
      closed = true;
      if (held.heartbeat !== undefined) clearInterval(held.heartbeat);
      if (held.expiry !== undefined) clearTimeout(held.expiry);
      held.unsubscribe?.();
      body.end();
    };
    const write = (chunk: string): void => {
      if (!closed) body.write(chunk);
    };

    const subscribed = this.hub.subscribe({ accountId: user.accountId, write });
    if (!subscribed.ok) {
      if (subscribed.reason === 'too_many') throw new AppError('rate_limited', { retryAfterSeconds: 30 });
      throw new AppError('service_unavailable');
    }
    held.unsubscribe = subscribed.unsubscribe;

    const heartbeat = setInterval(() => {
      void this.auth
        .isSessionLive(token)
        .then((live) => (live ? write(HEARTBEAT_FRAME) : close()))
        .catch(() => close());
    }, HEARTBEAT_MS);
    held.heartbeat = heartbeat;
    heartbeat.unref();
    const untilExpiry = Math.max(0, user.sessionExpiresAt.getTime() - this.clock().getTime());
    const expiry = setTimeout(close, Math.min(untilExpiry, 2 ** 31 - 1));
    held.expiry = expiry;
    expiry.unref();
    request.raw.once('close', close);

    // `retry`: how long the browser waits before reconnecting after a drop.
    body.write(`retry: 5000\n: connected\n\n`);
    void reply
      .status(200)
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache, no-transform')
      .header('x-accel-buffering', 'no')
      .header('connection', 'keep-alive')
      .send(body);
  }
}
