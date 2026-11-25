import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SYNC_EVENT_TOPICS, type SyncEventTopic } from '@salesforce/contracts';
import type { DbHandle } from '@salesforce/db';
import type { Logger } from '../observability/logger.js';
import { dedicatedClientFactory, EVENTS_CHANNEL, PgListener, type ListenClient } from '../platform/pg-listener.js';
import { DATABASE_HANDLE, LOGGER } from '../platform/tokens.js';
import { EVENT_STREAM_ENABLED, EVENT_STREAM_LIMITS, type EventStreamLimits } from './events.tokens.js';

export const DEFAULT_EVENT_STREAM_LIMITS: EventStreamLimits = { perAccount: 5, total: 200 };

export interface EventSubscriber {
  readonly accountId: string;
  /** Writes one already-framed SSE chunk. */
  readonly write: (chunk: string) => void;
}

export type SubscribeResult = { readonly ok: true; readonly unsubscribe: () => void } | { readonly ok: false; readonly reason: 'unavailable' | 'too_many' };

/** One SSE frame: content-free (a topic only). */
export function pingFrame(topic: SyncEventTopic): string {
  return `event: ping\ndata: ${JSON.stringify({ topic })}\n\n`;
}

function topicOf(payload: string): SyncEventTopic | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    const topic = typeof parsed === 'object' && parsed !== null ? (parsed as { topic?: unknown }).topic : undefined;
    return SYNC_EVENT_TOPICS.find((candidate) => candidate === topic) ?? null;
  } catch {
    return null;
  }
}

/**
 * RT-1: the API's ONE dedicated PostgreSQL connection doing `LISTEN sf_events`, fanned out to the open streams. Payloads are
 * content-free topics; the hub never reads business data. When the connection is down (or the feature is off) it refuses new
 * streams (503) and clients fall back to their timed refresh.
 */
@Injectable()
export class EventsHub implements OnModuleInit, OnModuleDestroy {
  readonly #subscribers = new Set<EventSubscriber>();
  readonly #listener: PgListener;

  constructor(
    @Inject(DATABASE_HANDLE) private readonly handle: DbHandle,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(EVENT_STREAM_ENABLED) private readonly enabled: boolean,
    @Inject(EVENT_STREAM_LIMITS) private readonly limits: EventStreamLimits,
  ) {
    this.#listener = new PgListener({
      clientFactory: (): ListenClient => dedicatedClientFactory(this.handle.pool, 'salesforce-api-events')(),
      channel: EVENTS_CHANNEL,
      logger: this.logger,
      onMessage: (payload) => this.dispatch(payload),
      // Pings sent while the connection was down are lost: tell every client to re-read once.
      onConnected: () => {
        for (const topic of SYNC_EVENT_TOPICS) this.broadcast(topic);
      },
    });
  }

  onModuleInit(): void {
    if (this.enabled) this.#listener.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.#listener.stop();
    this.#subscribers.clear();
  }

  get streamCount(): number {
    return this.#subscribers.size;
  }

  subscribe(subscriber: EventSubscriber): SubscribeResult {
    if (!this.enabled || !this.#listener.connected) return { ok: false, reason: 'unavailable' };
    let ofAccount = 0;
    for (const existing of this.#subscribers) if (existing.accountId === subscriber.accountId) ofAccount += 1;
    if (ofAccount >= this.limits.perAccount || this.#subscribers.size >= this.limits.total) return { ok: false, reason: 'too_many' };
    this.#subscribers.add(subscriber);
    return { ok: true, unsubscribe: () => void this.#subscribers.delete(subscriber) };
  }

  /** Test seam and the listener's entry point: one NOTIFY payload. */
  dispatch(payload: string): void {
    const topic = topicOf(payload);
    if (topic !== null) this.broadcast(topic);
  }

  private broadcast(topic: SyncEventTopic): void {
    const frame = pingFrame(topic);
    for (const subscriber of this.#subscribers) {
      try {
        subscriber.write(frame);
      } catch (error) {
        this.logger.warn({ err: error }, 'event stream write failed');
        this.#subscribers.delete(subscriber);
      }
    }
  }
}
