import { onTestFinished, vi } from "vitest";

/** Product/profile images load through the guarded client (blob URLs): stubs `fetch` and the object URL API. Restored when the test ends. */
export function stubGuardedImages() {
  let counter = 0;
  const original = globalThis.fetch;
  URL.createObjectURL = vi.fn(() => `blob:image-${++counter}`);
  URL.revokeObjectURL = vi.fn();
  const fetchStub = vi.fn(async (_request: Request) => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 }));
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  onTestFinished(() => {
    globalThis.fetch = original;
  });
  /** Paths (with query) of the images requested so far. */
  const requested = () =>
    fetchStub.mock.calls.map(([request]) => {
      const url = new URL(request.url);
      return url.pathname + url.search;
    });
  return { fetchStub, requested };
}
