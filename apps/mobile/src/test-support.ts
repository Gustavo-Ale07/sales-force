/** Test helpers: a scripted `fetch` that records the requests the generated client sends. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface ScriptedResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export type Responder = (request: RecordedRequest) => ScriptedResponse | Error;

export function scriptedFetch(respond: Responder) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (request: Request): Promise<Response> => {
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    const recorded: RecordedRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: text === "" ? undefined : JSON.parse(text),
    };
    requests.push(recorded);
    const result = respond(recorded);
    if (result instanceof Error) throw result;
    const payload = result.body === undefined ? null : JSON.stringify(result.body);
    return new Response(result.status === 204 ? null : payload, {
      status: result.status,
      headers: { "content-type": "application/json", ...result.headers },
    });
  };
  return { fetch: fetchImpl, requests };
}
