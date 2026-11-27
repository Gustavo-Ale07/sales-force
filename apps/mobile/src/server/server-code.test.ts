import { SERVER_CODE_HEADER, encodeServerCode } from "@salesforce/contracts";
import { addServer, loadStoredServer } from "./add-server";
import { checkServerCode, connectionFromCode, onServerCodeRejected, setServerConnection, withServerCode, withServerCodeRequest, withServerCodeStream, type ServerCodeStore } from "./server-connection";
import { createMobileApiClient } from "../data/api";

const KEY = "A".repeat(43);
const CODE = encodeServerCode({ a: "https://api.example.com", k: KEY });

function memoryStore(initial: string | null = null): ServerCodeStore & { value: string | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (code: string) => {
      store.value = code;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

afterEach(() => setServerConnection(null));

describe("server code connection", () => {
  it("takes the API base from the code and keeps only the key for the header", () => {
    const connection = connectionFromCode(CODE);
    expect(connection).toEqual({ baseUrl: expect.stringMatching(/^https:\/\/api\.example\.com\//), origin: "https://api.example.com", key: KEY });
  });

  it("refuses text that is not a code", () => {
    expect(connectionFromCode("abc")).toBeNull();
    expect(connectionFromCode("sf1.@@@")).toBeNull();
  });
});

describe("Adicionar servidor", () => {
  it("with no stored code the app starts with nothing connected", async () => {
    expect(await loadStoredServer(memoryStore())).toEqual({ kind: "none" });
  });

  it("an invalid code is not kept and the server is not even asked when it is malformed", async () => {
    const store = memoryStore();
    const fetchImpl = jest.fn();
    expect(await addServer("lixo", { store, check: (raw) => checkServerCode(raw, fetchImpl) })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.value).toBeNull();
  });

  it("a code the server refuses (401) is not kept", async () => {
    const store = memoryStore();
    const fetchImpl = jest.fn(async () => new Response(null, { status: 401 }));
    expect(await addServer(CODE, { store, check: (raw) => checkServerCode(raw, fetchImpl) })).toBeNull();
    expect(store.value).toBeNull();
  });

  it("a valid code is checked with only its key in the header, then kept", async () => {
    const store = memoryStore();
    const fetchImpl = jest.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    const connection = await addServer(` ${CODE}\n`, { store, check: (raw) => checkServerCode(raw, fetchImpl) });
    expect(connection?.origin).toBe("https://api.example.com");
    expect(store.value).toBe(CODE);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toMatch(/^https:\/\/api\.example\.com\/.*\/server-code\/check$/);
    expect(init?.headers).toEqual({ [SERVER_CODE_HEADER]: KEY });
    expect(JSON.stringify(init)).not.toContain(CODE);
  });

  it("a stored code is read back; a stored value that is not a code is dropped", async () => {
    const good = await loadStoredServer(memoryStore(CODE));
    expect(good.kind).toBe("ready");
    const bad = memoryStore("lixo");
    expect(await loadStoredServer(bad)).toEqual({ kind: "none" });
    expect(bad.value).toBeNull();
  });
});

describe("header on every request and guard 401", () => {
  it("the API client sends X-Server-Code on every call", async () => {
    setServerConnection(connectionFromCode(CODE));
    const seen: string[] = [];
    const api = createMobileApiClient("https://api.example.com/api/v1", {
      fetch: async (request) => {
        seen.push(request.headers.get(SERVER_CODE_HEADER) ?? "");
        return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    await api.GET("/auth/session");
    await api.GET("/auth/session");
    expect(seen).toEqual([KEY, KEY]);
  });

  it("a plain fetch (updates, downloads) carries the key too", async () => {
    setServerConnection(connectionFromCode(CODE));
    let header: string | null = null;
    await withServerCode(async (_url: string | Request, init?: RequestInit) => {
      header = new Headers(init?.headers).get(SERVER_CODE_HEADER);
      return new Response("{}", { status: 200 });
    })("https://api.example.com/x");
    expect(header).toBe(KEY);
  });

  it("a 401 with an empty body reports the code as rejected; a 401 with the error envelope does not", async () => {
    const rejected = jest.fn();
    const off = onServerCodeRejected(rejected);
    const guard = withServerCodeRequest(async () => new Response(null, { status: 401 }));
    await guard(new Request("https://api.example.com/x"));
    expect(rejected).toHaveBeenCalledTimes(1);
    const session = withServerCodeRequest(async () => new Response(JSON.stringify({ code: "unauthenticated", message: "x" }), { status: 401, headers: { "content-type": "application/json" } }));
    await session(new Request("https://api.example.com/x"));
    expect(rejected).toHaveBeenCalledTimes(1);
    off();
  });

  it("images and the stream carry the key, and an empty 401 there never reports the code as rejected", async () => {
    setServerConnection(connectionFromCode(CODE));
    const rejected = jest.fn();
    const off = onServerCodeRejected(rejected);
    const seen: (string | null)[] = [];
    const media = createMobileApiClient("http://api.test/api", {
      quietRejection: true,
      fetch: async (request) => {
        seen.push(request.headers.get(SERVER_CODE_HEADER));
        return new Response(null, { status: 401 });
      },
    });
    const image = await media.GET("/products/{code}/image", { params: { path: { code: 1 }, query: { variant: "thumb" } }, parseAs: "arrayBuffer" });
    expect(image.response.status).toBe(401);
    const stream = withServerCodeStream(async (_url, init) => {
      seen.push(init.headers?.[SERVER_CODE_HEADER] ?? null);
      return { ok: false, status: 401 };
    });
    expect((await stream("http://api.test/api/sync/events", { headers: { Accept: "text/event-stream" } })).status).toBe(401);
    expect(seen).toEqual([KEY, KEY]);
    expect(rejected).not.toHaveBeenCalled();
    off();
  });
});
