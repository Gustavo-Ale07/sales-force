import { GARBAGE, JPEG, PNG, WEBP, memoryImageFileSystem, ok } from "./image-test-doubles";
import { createProductImageStore, type ImageFetchOutcome, type ProductImageStore } from "./image-store";

const image = (version: string) => ({ version });

function setup(
  overrides: {
    scope?: () => Promise<string | null>;
    ownerAccountId?: string;
    memory?: ReturnType<typeof memoryImageFileSystem>;
    fetch?: (code: number) => Promise<ImageFetchOutcome>;
    maxTotalBytes?: number;
    timeoutMs?: number;
    failureRetryMs?: number;
  } = {},
) {
  const memory = overrides.memory ?? memoryImageFileSystem();
  const calls: number[] = [];
  let clock = 1_000;
  const store: ProductImageStore = createProductImageStore({
    fs: memory.fs,
    fetchThumbnail: (code) => {
      calls.push(code);
      return (overrides.fetch ?? (async () => ok(PNG)))(code);
    },
    scope: overrides.scope ?? (async () => "owner-1|production|ds-1"),
    now: () => (clock += 1),
    ...(overrides.ownerAccountId === undefined ? {} : { ownerAccountId: overrides.ownerAccountId }),
    ...(overrides.maxTotalBytes === undefined ? {} : { maxTotalBytes: overrides.maxTotalBytes }),
    timeoutMs: overrides.timeoutMs ?? 50,
    failureRetryMs: overrides.failureRetryMs ?? 60_000,
  });
  return { store, memory, calls, tick: (ms: number) => (clock += ms) };
}

const imageFiles = (memory: ReturnType<typeof memoryImageFileSystem>) => [...memory.files.keys()].filter((name) => name.endsWith(".img"));

describe("product image store", () => {
  it("downloads once, stores a file and reuses it offline without touching the network", async () => {
    const { store, calls } = setup();
    const first = await store.resolve(1, image("v1"), { online: true });
    expect(first).toMatch(/^file:\/\/\/images\/p1-/);
    expect(await store.resolve(1, image("v1"), { online: false })).toBe(first);
    expect(calls).toEqual([1]);
  });

  it("survives a restart: a new store over the same files reuses the cached thumbnail", async () => {
    const { store, memory, calls } = setup();
    const uri = await store.resolve(1, image("v1"), { online: true });
    const reopened = createProductImageStore({
      fs: memory.fs,
      fetchThumbnail: async () => ok(PNG),
      scope: async () => "owner-1|production|ds-1",
      now: () => 5,
    });
    expect(await reopened.resolve(1, image("v1"), { online: false })).toBe(uri);
    expect(calls).toEqual([1]);
  });

  it("offline miss gives no image and does not remember it as a failure", async () => {
    const { store, calls } = setup();
    expect(await store.resolve(1, image("v1"), { online: false })).toBeNull();
    expect(calls).toEqual([]);
    expect(await store.resolve(1, image("v1"), { online: true })).not.toBeNull();
  });

  it("404 = no image: placeholder, remembered for the session (no refetch per scroll)", async () => {
    const { store, calls } = setup({ fetch: async () => ({ kind: "absent" }) });
    expect(await store.resolve(1, image("v1"), { online: true })).toBeNull();
    expect(await store.resolve(1, image("v1"), { online: true })).toBeNull();
    expect(calls).toEqual([1]);
    await store.resolve(1, image("v2"), { online: true }); // a new version is a new chance
    expect(calls).toEqual([1, 1]);
  });

  it("503 / network error: placeholder now, retried only after the backoff", async () => {
    let outcome: ImageFetchOutcome = { kind: "unavailable" };
    const { store, calls, tick } = setup({ fetch: async () => outcome, failureRetryMs: 1_000 });
    expect(await store.resolve(1, image("v1"), { online: true })).toBeNull();
    expect(await store.resolve(1, image("v1"), { online: true })).toBeNull();
    expect(calls).toEqual([1]);
    tick(2_000);
    outcome = ok(PNG);
    expect(await store.resolve(1, image("v1"), { online: true })).not.toBeNull();
    expect(calls).toEqual([1, 1]);
  });

  it("a thrown fetch is a placeholder, not a crash", async () => {
    const { store } = setup({ fetch: async () => Promise.reject(new Error("boom")) });
    expect(await store.resolve(1, image("v1"), { online: true })).toBeNull();
  });

  it("a timeout becomes a placeholder and does not hang the row", async () => {
    const { store } = setup({ fetch: () => new Promise<ImageFetchOutcome>(() => undefined), timeoutMs: 20 });
    expect(await store.resolve(1, image("v1"), { online: true })).toBeNull();
  });

  it("rejects corrupt bytes (not png/jpeg/webp, empty, oversized) and stores nothing", async () => {
    for (const bytes of [GARBAGE, new Uint8Array(0), new Uint8Array(600 * 1024).fill(0x89)]) {
      const { store, memory } = setup({ fetch: async () => ok(bytes) });
      expect(await store.resolve(1, image("v1"), { online: true })).toBeNull();
      expect(imageFiles(memory)).toEqual([]);
    }
  });

  it("accepts png, jpeg and webp", async () => {
    for (const bytes of [PNG, JPEG, WEBP]) {
      const { store } = setup({ fetch: async () => ok(bytes) });
      expect(await store.resolve(1, image("v1"), { online: true })).not.toBeNull();
    }
  });

  it("a WebP thumbnail is stored byte-for-byte under a neutral .img name and served from cache offline", async () => {
    const { store, memory, calls } = setup({ fetch: async () => ok(WEBP) });
    const uri = await store.resolve(1, image("v1"), { online: true });
    expect(uri).toMatch(/^file:\/\/\/images\/p1-\d+\.img$/);
    expect(imageFiles(memory)).toHaveLength(1);
    expect(memory.files.get(imageFiles(memory)[0] as string)).toEqual(WEBP);
    expect(await store.resolve(1, image("v1"), { online: false })).toBe(uri);
    expect(calls).toEqual([1]);
  });

  it("a version change after a remembered 404 (thumbnail appeared) refetches, stores and serves the image", async () => {
    let outcome: ImageFetchOutcome = { kind: "absent" };
    const { store, memory, calls } = setup({ fetch: async () => outcome });
    expect(await store.resolve(1, image("orig-only"), { online: true })).toBeNull();
    expect(await store.resolve(1, image("orig-only"), { online: true })).toBeNull();
    expect(calls).toEqual([1]); // the 404 is remembered for the same version
    outcome = ok(WEBP);
    const uri = await store.resolve(1, image("orig+thumb"), { online: true });
    expect(uri).not.toBeNull();
    expect(calls).toEqual([1, 1]);
    expect(imageFiles(memory)).toHaveLength(1);
    expect(await store.resolve(1, image("orig+thumb"), { online: false })).toBe(uri);
  });

  it("holds hundreds of realistic thumbnails (20 KiB) inside the default 20 MiB budget and evicts only beyond it", async () => {
    const thumb = new Uint8Array(20 * 1024);
    thumb.set(WEBP);
    const { store, memory } = setup({ fetch: async () => ok(thumb) });
    for (let code = 1; code <= 1100; code += 1) await store.resolve(code, image("v"), { online: true });
    expect(imageFiles(memory)).toHaveLength(1024); // 20 MiB / 20 KiB
    expect(await store.resolve(1100, image("v"), { online: false })).not.toBeNull();
    expect(await store.resolve(1, image("v"), { online: false })).toBeNull(); // oldest evicted
  });

  it("a changed version replaces the file and deletes the old one", async () => {
    const { store, memory, calls } = setup();
    const v1 = await store.resolve(1, image("v1"), { online: true });
    const v2 = await store.resolve(1, image("v2"), { online: true });
    expect(v2).not.toBe(v1);
    expect(calls).toEqual([1, 1]);
    expect(imageFiles(memory)).toHaveLength(1);
  });

  it("a stale file (version changed) is never shown offline", async () => {
    const { store } = setup();
    await store.resolve(1, image("v1"), { online: true });
    expect(await store.resolve(1, image("v2"), { online: false })).toBeNull();
  });

  it("evicts the least recently used images beyond the size budget", async () => {
    const { store, memory } = setup({ maxTotalBytes: PNG.length * 2 });
    await store.resolve(1, image("v"), { online: true });
    await store.resolve(2, image("v"), { online: true });
    await store.resolve(1, image("v"), { online: false }); // touch 1: 2 is now the oldest
    await store.resolve(3, image("v"), { online: true });
    expect(await store.resolve(1, image("v"), { online: false })).not.toBeNull();
    expect(await store.resolve(2, image("v"), { online: false })).toBeNull();
    expect(await store.resolve(3, image("v"), { online: false })).not.toBeNull();
    expect(imageFiles(memory)).toHaveLength(2);
  });

  it("purges everything when the owner or the dataset changes, and nothing from the old scope is served", async () => {
    let scope: string | null = "owner-1|production|ds-1";
    const { store, memory } = setup({ scope: async () => scope });
    await store.resolve(1, image("v1"), { online: true });
    scope = "owner-2|production|ds-1";
    expect(await store.resolve(1, image("v1"), { online: false })).toBeNull();
    expect(imageFiles(memory)).toEqual([]);
    scope = "owner-2|production|ds-2";
    await store.resolve(2, image("v1"), { online: true });
    scope = "owner-2|production|ds-3";
    expect(await store.resolve(2, image("v1"), { online: false })).toBeNull();
    expect(imageFiles(memory)).toEqual([]);
  });

  it("another account on the device purges the previous owner files even before its own data is confirmed", async () => {
    const memory = memoryImageFileSystem();
    const first = setup({ memory, ownerAccountId: "owner-1" });
    await first.store.resolve(1, image("v1"), { online: true });
    expect(imageFiles(memory)).toHaveLength(1);
    // Account 2 signs in on the same device: its scope is unknown (cache not filled yet) so nothing can be served, yet the files of account 1 must go.
    const second = setup({ memory, ownerAccountId: "owner-2", scope: async () => null });
    expect(await second.store.resolve(1, image("v1"), { online: false })).toBeNull();
    expect(imageFiles(memory)).toEqual([]);
  });

  it("the SAME owner keeps the files while the dataset is momentarily unconfirmed (e.g. after a session expiry)", async () => {
    const memory = memoryImageFileSystem();
    const first = setup({ memory, ownerAccountId: "owner-1" });
    const uri = await first.store.resolve(1, image("v1"), { online: true });
    let scope: string | null = null;
    const again = setup({ memory, ownerAccountId: "owner-1", scope: async () => scope });
    expect(await again.store.resolve(1, image("v1"), { online: false })).toBeNull(); // not served without a confirmed scope
    expect(imageFiles(memory)).toHaveLength(1); // but not deleted
    scope = "owner-1|production|ds-1";
    expect(await again.store.resolve(1, image("v1"), { online: false })).toBe(uri); // back for the same owner, no refetch
  });

  it("without a confirmed scope (unknown dataset) it shows and stores nothing", async () => {
    const { store, calls } = setup({ scope: async () => null });
    expect(await store.resolve(1, image("v1"), { online: true })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("purge() (sign-out) deletes every file and the index", async () => {
    const { store, memory } = setup();
    await store.resolve(1, image("v1"), { online: true });
    await store.purge();
    expect(memory.files.size).toBe(0);
    expect(await store.resolve(1, image("v1"), { online: false })).toBeNull();
  });

  it("a corrupt index is discarded, not trusted", async () => {
    const { store, memory } = setup();
    await store.resolve(1, image("v1"), { online: true });
    memory.files.set("index.json", "{not json");
    const reopened = createProductImageStore({
      fs: memory.fs,
      fetchThumbnail: async () => ok(PNG),
      scope: async () => "owner-1|production|ds-1",
      now: () => 1,
    });
    expect(await reopened.resolve(1, image("v1"), { online: false })).toBeNull();
    expect(imageFiles(memory)).toEqual([]);
  });

  it("deduplicates concurrent requests for the same image and limits parallel downloads", async () => {
    let active = 0;
    let peak = 0;
    const { store, calls } = setup({
      fetch: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return ok(PNG);
      },
    });
    await Promise.all([store.resolve(1, image("v"), { online: true }), store.resolve(1, image("v"), { online: true })]);
    expect(calls).toEqual([1]);
    await Promise.all([2, 3, 4, 5, 6, 7].map((code) => store.resolve(code, image("v"), { online: true })));
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("skips a download whose row was already scrolled away (aborted before it started)", async () => {
    const { store, calls } = setup({ fetch: () => new Promise<ImageFetchOutcome>((resolve) => setTimeout(() => resolve(ok(PNG)), 10)) });
    const controller = new AbortController();
    const running = [1, 2, 3].map((code) => store.resolve(code, image("v"), { online: true }));
    const queued = store.resolve(9, image("v"), { online: true, signal: controller.signal });
    controller.abort();
    expect(await queued).toBeNull();
    await Promise.all(running);
    expect(calls).not.toContain(9);
  });
});
