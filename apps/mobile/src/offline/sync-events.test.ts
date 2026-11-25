import type { ApiClient } from "../data/api";
import { createReferenceSource } from "./reference-source";
import { startSyncEvents, topicOfFrame, type StreamFetch, type SyncEventTopic } from "./sync-events";

const ok = { ok: true, status: 200 } as Response;
const encode = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

function streamOf(chunks: string[]) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (index < chunks.length ? { done: false, value: encode(chunks[index++]!) } : { done: true }),
      }),
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 0));

describe("topicOfFrame", () => {
  it("reads the topic of a ping and ignores heartbeats and unknown topics", () => {
    expect(topicOfFrame('event: ping\ndata: {"topic":"orders"}')).toBe("orders");
    expect(topicOfFrame('data: {"topic":"reference"}')).toBe("reference");
    expect(topicOfFrame(": heartbeat")).toBeNull();
    expect(topicOfFrame('data: {"topic":"other"}')).toBeNull();
    expect(topicOfFrame("data: not json")).toBeNull();
  });
});

describe("startSyncEvents", () => {
  it("delivers pings split across chunks, reports connection state and reconnects with backoff", async () => {
    const topics: SyncEventTopic[] = [];
    const connection: boolean[] = [];
    const sleeps: number[] = [];
    let calls = 0;
    const fetchStream: StreamFetch = async (url, init) => {
      calls += 1;
      expect(url).toBe("https://api.test/api/v1/sync/events");
      expect(init.credentials).toBe("include");
      if (calls === 1) return streamOf(['event: ping\ndata: {"topic":"ord', 'ers"}\n\n: hb\n\nevent: ping\ndata: {"topic":"reference"}\n\n']);
      if (calls === 2) return { ok: false, status: 503, body: null };
      return new Promise(() => undefined); // stays open
    };
    const stop = startSyncEvents({
      baseUrl: "https://api.test/api/v1",
      fetchStream,
      onTopic: (t) => topics.push(t),
      onConnection: (c) => connection.push(c),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 1,
    });
    for (let i = 0; i < 10; i += 1) await flush();
    stop();
    expect(topics).toEqual(["orders", "reference"]);
    expect(connection).toEqual([true, false]);
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(sleeps.slice(0, 2)).toEqual([1000, 2000]);
  });

  it("stops for good once closed (no reconnect)", async () => {
    let calls = 0;
    const stop = startSyncEvents({
      baseUrl: "https://api.test",
      fetchStream: async () => {
        calls += 1;
        return { ok: false, status: 429, body: null };
      },
      onTopic: () => undefined,
      onConnection: () => undefined,
      sleep: async () => undefined,
    });
    stop();
    for (let i = 0; i < 5; i += 1) await flush();
    expect(calls).toBeLessThanOrEqual(1);
  });
});

describe("reference source (RT-1)", () => {
  it("carries removedIds of the order read, the referenceVersion and the per-order refresh request", async () => {
    const posted: string[] = [];
    const api = {
      GET: async (path: string) =>
        path === "/sync/status"
          ? { data: { dataAsOf: null, referenceVersion: "v7" }, response: ok }
          : { data: { items: [], page: 1, pageSize: 100, total: 0, removedIds: ["gone"] }, response: ok },
      POST: async (path: string, init: { params: { path: { id: string } } }) => {
        expect(path).toBe("/orders/{id}/refresh");
        posted.push(init.params.path.id);
        return { data: { accepted: true }, response: ok };
      },
    } as unknown as ApiClient;
    const source = createReferenceSource(api);
    expect((await source.fetchOrderStatuses!(["gone"])).removedIds).toEqual(["gone"]);
    expect(await source.fetchReferenceVersion!()).toBe("v7");
    await source.requestOrderRefresh!("o-1");
    expect(posted).toEqual(["o-1"]);
  });
});
