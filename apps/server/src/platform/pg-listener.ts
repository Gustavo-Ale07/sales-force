import pg from 'pg';
import type { Logger } from '../observability/logger.js';

/** RT-1: PostgreSQL channels. Payloads are content-free: a topic (and, for the worker-bound refresh, one order id). */
export const EVENTS_CHANNEL = 'sf_events';
/** API -> worker: "re-read this order now" (`{"topic":"order_refresh","id":"<order uuid>"}`); never delivered to clients. */
export const ORDER_REFRESH_CHANNEL = 'sf_order_refresh';

export type EventTopic = 'orders' | 'reference';

/** One content-free ping on `sf_events`. NOTIFY needs no listener to be sent; a lost ping is covered by the clients' timed fallback. */
export async function notifyTopic(pool: Pick<pg.Pool, 'query'>, topic: EventTopic): Promise<void> {
  await pool.query('select pg_notify($1, $2)', [EVENTS_CHANNEL, JSON.stringify({ topic })]);
}

export async function notifyOrderRefresh(pool: Pick<pg.Pool, 'query'>, orderId: string): Promise<void> {
  await pool.query('select pg_notify($1, $2)', [ORDER_REFRESH_CHANNEL, JSON.stringify({ topic: 'order_refresh', id: orderId })]);
}

/** The slice of `pg.Client` the listener uses (tests replace it). */
export interface ListenClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  on(event: 'notification', handler: (message: { channel: string; payload?: string | undefined }) => void): unknown;
  on(event: 'error' | 'end', handler: (error?: Error) => void): unknown;
  end(): Promise<void>;
}

export interface PgListenerOptions {
  /** Connection options of a DEDICATED connection (never a pooled one: LISTEN state lives in the session). */
  readonly clientFactory: () => ListenClient;
  readonly channel: string;
  readonly onMessage: (payload: string) => void;
  readonly logger: Logger;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Called after every successful (re)connect: notifications sent while disconnected are lost, so the owner may resynchronize. */
  readonly onConnected?: () => void;
}

/** Builds a dedicated `pg.Client` from the options of an existing pool (same host, credentials and TLS settings). */
export function dedicatedClientFactory(pool: pg.Pool, applicationName: string): () => ListenClient {
  return () => {
    const { max: _max, ...connection } = pool.options;
    return new pg.Client({ ...connection, application_name: applicationName }) as unknown as ListenClient;
  };
}

/**
 * ONE dedicated connection doing `LISTEN <channel>`, reconnecting with exponential backoff (1 s up to 30 s) whenever it errors or
 * ends. A failing connection never takes the process down; it only logs and retries.
 */
export class PgListener {
  #client: ListenClient | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = true;
  #attempt = 0;

  constructor(private readonly options: PgListenerOptions) {}

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    void this.#connect();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    const client = this.#client;
    this.#client = undefined;
    if (client !== undefined) await client.end().catch(() => undefined);
  }

  get connected(): boolean {
    return this.#client !== undefined;
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    const client = this.options.clientFactory();
    let dropped = false;
    const drop = (error?: Error) => {
      if (dropped) return;
      dropped = true;
      if (this.#client === client) this.#client = undefined;
      void client.end().catch(() => undefined);
      if (this.#stopped) return;
      this.options.logger.warn({ channel: this.options.channel, err: error }, 'event channel connection lost; reconnecting');
      this.#schedule();
    };
    client.on('error', drop);
    client.on('end', () => drop());
    client.on('notification', (message) => {
      if (message.channel === this.options.channel && message.payload !== undefined) this.options.onMessage(message.payload);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${this.options.channel}`);
    } catch (error) {
      drop(error instanceof Error ? error : new Error('listen failed'));
      return;
    }
    if (this.#stopped) {
      await client.end().catch(() => undefined);
      return;
    }
    this.#client = client;
    this.#attempt = 0;
    this.options.logger.info({ channel: this.options.channel }, 'event channel listening');
    this.options.onConnected?.();
  }

  #schedule(): void {
    if (this.#stopped || this.#timer !== undefined) return;
    const initial = this.options.initialBackoffMs ?? 1000;
    const delay = Math.min(this.options.maxBackoffMs ?? 30_000, initial * 2 ** Math.min(this.#attempt, 10));
    this.#attempt += 1;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#connect();
    }, delay);
  }
}
