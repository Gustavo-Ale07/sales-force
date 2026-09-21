import { createServer, type Server } from 'node:http';
import type { Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import { HEARTBEAT_STALE_AFTER_MS } from '../platform/worker-heartbeat.js';

export type WorkerHealthState = 'starting' | 'ok' | 'stale' | 'stopping';

export interface WorkerHealthSnapshot {
  readonly healthy: boolean;
  readonly state: WorkerHealthState;
  readonly lastHeartbeatAt: string | null;
}

/**
 * Health signal of the worker process (used by the container HEALTHCHECK). Healthy = started, not
 * shutting down, and a heartbeat was recorded recently (a job ran through the queue, so pg-boss and
 * the database are working). A fresh process gets one stale-window of grace for its first beat.
 */
export class WorkerHealth {
  #startedAt: Date | null = null;
  #stopping = false;
  #lastBeatAt: Date | null = null;

  constructor(private readonly now: Clock) {}

  markStarted(): void {
    this.#startedAt = this.now();
  }

  markStopping(): void {
    this.#stopping = true;
  }

  recordBeat(at: Date): void {
    this.#lastBeatAt = at;
  }

  snapshot(): WorkerHealthSnapshot {
    const lastHeartbeatAt = this.#lastBeatAt?.toISOString() ?? null;
    if (this.#stopping) return { healthy: false, state: 'stopping', lastHeartbeatAt };
    if (this.#startedAt === null) return { healthy: false, state: 'starting', lastHeartbeatAt };
    const reference = this.#lastBeatAt ?? this.#startedAt;
    const healthy = this.now().getTime() - reference.getTime() <= HEARTBEAT_STALE_AFTER_MS;
    return { healthy, state: healthy ? 'ok' : 'stale', lastHeartbeatAt };
  }
}

export interface HealthServer {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Minimal loopback HTTP endpoint: `GET /health` -> 200 when healthy, 503 otherwise. Carries no
 * data beyond the state; it is meant for `127.0.0.1` inside the container, never for exposure.
 */
export function startHealthServer(options: {
  host: string;
  port: number;
  health: WorkerHealth;
  logger: Logger;
}): Promise<HealthServer> {
  const server: Server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const snapshot = options.health.snapshot();
      response.writeHead(snapshot.healthy ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: snapshot.healthy ? 'ok' : 'unhealthy', state: snapshot.state }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'not_found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      server.on('error', (error) => options.logger.error({ err: error }, 'worker health server error'));
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      options.logger.info({ host: options.host, port }, 'worker health endpoint listening');
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
