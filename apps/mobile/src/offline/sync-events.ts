/**
 * Client of `GET /sync/events` (RT-1): a Server-Sent Events stream of content-free pings (`{"topic":"orders"|"reference"}`).
 * A ping carries no business data; the app re-reads through the normal authorized endpoints. Same session as every other call
 * (the cookie jar of the native HTTP stack, see `data/api.ts`). Reconnects with backoff; the caller stops it in the background.
 */
export type SyncEventTopic = "orders" | "reference";

export interface StreamResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> ; cancel?(): Promise<void> } } | null;
}

export type StreamFetch = (url: string, init: { headers: Record<string, string>; credentials: "include"; signal: AbortSignal }) => Promise<StreamResponse>;

export interface SyncEventsOptions {
  readonly baseUrl: string;
  readonly fetchStream: StreamFetch;
  readonly onTopic: (topic: SyncEventTopic) => void;
  /** `true` once the stream is open, `false` when it is lost (the caller then relies on its timers). */
  readonly onConnection: (connected: boolean) => void;
  /** Test seams. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

/** Parses the text of one SSE frame ("event: ping\ndata: {...}") into a topic, or `null` (comment, heartbeat, unknown). */
export function topicOfFrame(frame: string): SyncEventTopic | null {
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (data === "") return null;
  try {
    const topic = (JSON.parse(data) as { topic?: unknown }).topic;
    return topic === "orders" || topic === "reference" ? topic : null;
  } catch {
    return null;
  }
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

/** Opens the stream and keeps it open until the returned function is called. Never throws. */
export function startSyncEvents(options: SyncEventsOptions): () => void {
  const controller = new AbortController();
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const decoder = new (globalThis as unknown as { TextDecoder: new () => { decode(input: Uint8Array, options?: { stream: boolean }): string } }).TextDecoder();
  void (async () => {
    let delay = BACKOFF_START_MS;
    while (!controller.signal.aborted) {
      let connected = false;
      try {
        const response = await options.fetchStream(`${options.baseUrl}/sync/events`, { headers: { Accept: "text/event-stream" }, credentials: "include", signal: controller.signal });
        // 401/403/429/503 and a missing body end the attempt; the caller's timers keep the data fresh meanwhile.
        if (response.ok && response.body !== null) {
          const reader = response.body.getReader();
          connected = true;
          delay = BACKOFF_START_MS;
          options.onConnection(true);
          let buffer = "";
          while (!controller.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: true }).replace(/\r\n/g, "\n");
            for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
              const topic = topicOfFrame(buffer.slice(0, end));
              buffer = buffer.slice(end + 2);
              if (topic !== null) options.onTopic(topic);
            }
          }
        }
      } catch {
        // Dropped connection or network error: reconnect below.
      }
      if (connected) options.onConnection(false);
      if (controller.signal.aborted) return;
      await sleep(Math.round(delay * (0.5 + random() / 2)), controller.signal);
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
    }
  })();
  return () => {
    controller.abort();
  };
}
