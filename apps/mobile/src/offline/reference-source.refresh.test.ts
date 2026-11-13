import { TransportError } from "@salesforce/mobile-db";
import { ApiRequestError, type ApiClient } from "../data/api";
import { createReferenceSource } from "./reference-source";

const ID = "018f0000-0000-7000-8000-000000000001";
const ok = { ok: true, status: 200 } as Response;
const fail = (status: number) => ({ response: { ok: false, status, headers: new Headers() } as Response, error: { code: "x", message: "x" } });

const step = (entity: string, status: string): { entity: string; status: string; durationMs: null; reason: string | null; lastSuccessAt: null } => ({ entity, status, durationMs: null, reason: null, lastSuccessAt: null });
const detail = (status: string, steps: ReturnType<typeof step>[]) => ({ id: ID, status, requestedAt: "2026-11-13T12:00:00.000Z", startedAt: null, finishedAt: null, steps });
const basic = (status: string, extra: Record<string, unknown> = {}) => ({ id: ID, status, progressPercent: 50, phase: "precos", finishedAt: null, hasWarnings: false, ...extra });

interface Script {
  post: () => unknown;
  gets: (() => unknown)[];
}

function apiWith(script: Script) {
  const calls: string[] = [];
  const api = {
    POST: async (path: string) => {
      calls.push(`POST ${path}`);
      return script.post();
    },
    GET: async (path: string) => {
      calls.push(`GET ${path}`);
      const next = script.gets.shift();
      if (next === undefined) throw new Error("no more scripted GET");
      return next();
    },
  } as unknown as ApiClient;
  return { api, calls };
}

const answer = (data: unknown) => ({ data, response: ok });
const instant = { pollIntervalMs: 0, sleep: async () => undefined };

describe("refreshOnDemand (POST /sync/refresh, then follow it until done)", () => {
  it("starts the refresh, follows it until done and reports no failure; progress uses friendly labels", async () => {
    const { api, calls } = apiWith({
      post: () => answer({ ...detail("running", [step("customers", "running")]), reused: false }),
      gets: [() => answer(detail("running", [step("customers", "ok"), step("listPrices", "running")])), () => answer(detail("done", [step("customers", "ok"), step("listPrices", "ok")]))],
    });
    const seen: string[] = [];
    const outcome = await createReferenceSource(api, instant).refreshOnDemand!((p) => seen.push(p.label));
    expect(outcome).toEqual({ failed: false, failedSteps: [] });
    expect(calls).toEqual(["POST /sync/refresh", "GET /sync/refresh/{id}", "GET /sync/refresh/{id}"]);
    expect(seen).toEqual(["Atualizando clientes", "Atualizando preços"]);
  });

  it("detail view with failed steps: names them in plain Portuguese, never the technical reason", async () => {
    const { api } = apiWith({
      post: () => answer({ ...detail("done", [step("customers", "ok"), { ...step("listPrices", "failed"), reason: "SQL secreto" }, step("carriers", "failed")]), reused: true }),
      gets: [],
    });
    const outcome = await createReferenceSource(api, instant).refreshOnDemand!(() => undefined);
    expect(outcome).toEqual({ failed: true, failedSteps: ["Preços", "Transportadoras"] });
  });

  it("seller basic view: progress by phase and failure known only through hasWarnings", async () => {
    const { api } = apiWith({
      post: () => answer({ ...basic("running"), reused: false }),
      gets: [() => answer(basic("done", { phase: "concluido", progressPercent: 100, hasWarnings: true }))],
    });
    const seen: { label: string; percent: number | null }[] = [];
    const outcome = await createReferenceSource(api, instant).refreshOnDemand!((p) => seen.push(p));
    expect(outcome).toEqual({ failed: true, failedSteps: [] });
    expect(seen[0]).toEqual({ label: "Atualizando preços", percent: 50 });
  });

  it("403 (this profile cannot start a refresh): skipped, the download goes ahead", async () => {
    const { api } = apiWith({ post: () => fail(403), gets: [] });
    expect(await createReferenceSource(api, instant).refreshOnDemand!(() => undefined)).toEqual({ failed: false, failedSteps: [] });
  });

  it("no network is a network TransportError; a 5xx is a server one", async () => {
    const down = apiWith({
      post: () => {
        throw new Error("Network request failed");
      },
      gets: [],
    });
    await expect(createReferenceSource(down.api, instant).refreshOnDemand!(() => undefined)).rejects.toMatchObject({ kind: "network" });
    const bad = apiWith({ post: () => fail(502), gets: [] });
    await expect(createReferenceSource(bad.api, instant).refreshOnDemand!(() => undefined)).rejects.toMatchObject({ kind: "server" });
  });

  it("a refresh that never finishes times out as 'server unavailable'", async () => {
    let now = 0;
    const { api } = apiWith({
      post: () => answer({ ...basic("running"), reused: false }),
      gets: Array.from({ length: 50 }, () => () => answer(basic("running"))),
    });
    const source = createReferenceSource(api, {
      pollIntervalMs: 1000,
      timeoutMs: 5000,
      sleep: async (ms: number) => {
        now += ms;
      },
      now: () => now,
    });
    const error = await source.refreshOnDemand!(() => undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ kind: "server" });
  });

  it("a poll that fails midway surfaces the transport error (the base stays as it was)", async () => {
    const { api } = apiWith({
      post: () => answer({ ...basic("running"), reused: false }),
      gets: [() => { throw new ApiRequestError({ status: 0, message: "x" }); }],
    });
    await expect(createReferenceSource(api, instant).refreshOnDemand!(() => undefined)).rejects.toMatchObject({ kind: "network" });
  });
});
