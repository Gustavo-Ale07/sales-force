import { createMobileApiClient } from "../data/api";
import { createThumbnailFetcher } from "./product-images";
import { PNG } from "./image-test-doubles";

function fetcherFor(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const api = createMobileApiClient("http://api.test/api", {
    fetch: async (request) => {
      requests.push(request);
      return respond(request);
    },
  });
  return { fetchThumbnail: createThumbnailFetcher(api), requests };
}

describe("authenticated thumbnail fetch", () => {
  it("requests the thumb variant through the session-carrying client and returns the bytes", async () => {
    const { fetchThumbnail, requests } = fetcherFor(() => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    const outcome = await fetchThumbnail(42, new AbortController().signal);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect([...outcome.bytes]).toEqual([...PNG]);
    expect(requests[0]!.url).toBe("http://api.test/api/products/42/image?variant=thumb");
    expect(requests[0]!.credentials).toBe("include");
    expect(requests[0]!.headers.get("accept")).toContain("image/");
  });

  it("404 is 'absent'; 503, 401, 500 and a network failure are 'unavailable'", async () => {
    for (const [status, kind] of [[404, "absent"], [503, "unavailable"], [401, "unavailable"], [500, "unavailable"]] as const) {
      const { fetchThumbnail } = fetcherFor(() => Response.json({ code: "x", message: "m" }, { status }));
      expect((await fetchThumbnail(1, new AbortController().signal)).kind).toBe(kind);
    }
    const { fetchThumbnail } = fetcherFor(() => Promise.reject(new TypeError("Network request failed")));
    expect((await fetchThumbnail(1, new AbortController().signal)).kind).toBe("unavailable");
  });
});
