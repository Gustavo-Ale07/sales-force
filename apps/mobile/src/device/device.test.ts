import { createMobileApiClient } from "../data/api";
import { createHttpAuth } from "../auth/http-auth";
import { evaluateOfflineAccess, effectiveOfflineMaxDays, type RememberedSession } from "../offline/session";
import { scriptedFetch } from "../test-support";
import { createInstallIdStore } from "./install-id";
import { notifyDeviceRevoked, onDeviceRevoked } from "./revocation";

const BASE = "http://api.test/api/v1";
const account = { id: "0190a0c0-0000-7000-8000-000000000001", username: "ana", displayName: "Ana", role: "seller" as const, sellerCodes: [7] };

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    read: async () => value,
    write: async (next: string) => {
      value = next;
    },
    remove: async () => {
      value = null;
    },
  };
}

describe("install id store", () => {
  it("creates once and keeps the same id until reset", async () => {
    let n = 0;
    const store = createInstallIdStore(memoryStorage(), () => `install-id-${++n}`);
    expect(await store.getOrCreate()).toBe("install-id-1");
    expect(await store.getOrCreate()).toBe("install-id-1");
    await store.reset();
    expect(await store.getOrCreate()).toBe("install-id-2");
  });

  it("replaces a stored value that is not a valid id", async () => {
    const store = createInstallIdStore(memoryStorage("curto"), () => "install-id-novo");
    expect(await store.getOrCreate()).toBe("install-id-novo");
  });
});

describe("offline lock by days (RF-IAM-8)", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-11-26T12:00:00.000Z");
  const remembered = (days: number, offlineMaxDays?: number): RememberedSession => ({
    account,
    lastOnlineAt: new Date(now.getTime() - days * day).toISOString(),
    ...(offlineMaxDays === undefined ? {} : { offlineMaxDays }),
  });

  it("uses 7 days when the server reported none", () => {
    expect(evaluateOfflineAccess(remembered(6.9), now).allowed).toBe(true);
    expect(evaluateOfflineAccess(remembered(7.1), now)).toEqual({ allowed: false, reason: "expired" });
  });

  it("uses the days reported for the device", () => {
    expect(evaluateOfflineAccess(remembered(10, 14), now).allowed).toBe(true);
    expect(evaluateOfflineAccess(remembered(3, 2), now)).toEqual({ allowed: false, reason: "expired" });
  });

  it("falls back to the default for a value out of range", () => {
    expect(effectiveOfflineMaxDays(0)).toBe(7);
    expect(effectiveOfflineMaxDays(61)).toBe(7);
    expect(effectiveOfflineMaxDays(2.5)).toBe(7);
    expect(effectiveOfflineMaxDays(null)).toBe(7);
    expect(effectiveOfflineMaxDays(30)).toBe(30);
  });
});

describe("device in the login and the wipe signal", () => {
  const registration = { installId: "install-abc-123", label: "Android", platform: "android" as const };

  it("sends the installation at login and returns the device", async () => {
    const device = { id: "0190a0c0-0000-7000-8000-0000000000d1", status: "pending", offlineMaxDays: 7 };
    const scripted = scriptedFetch(() => ({ status: 200, body: { authenticated: true, authMode: "dev", account, expiresAt: "2026-12-01T00:00:00.000Z", device } }));
    const auth = createHttpAuth(createMobileApiClient(BASE, { fetch: scripted.fetch }), async () => registration);
    const result = await auth.login({ username: "ana", password: "segredo" });
    expect(result).toMatchObject({ ok: true, device });
    expect(scripted.requests[0]?.body).toMatchObject({ client: "app", device: registration });
  });

  it("maps a revoked installation at login to its own reason", async () => {
    const scripted = scriptedFetch(() => ({ status: 401, body: { code: "device_revoked", message: "x" } }));
    const auth = createHttpAuth(createMobileApiClient(BASE, { fetch: scripted.fetch }), async () => registration);
    await expect(auth.login({ username: "ana", password: "p" })).resolves.toEqual({ ok: false, reason: "device_revoked" });
  });

  it("any API call answered 401 device_revoked fires the wipe signal; other 401s do not", async () => {
    const heard: number[] = [];
    const off = onDeviceRevoked(() => heard.push(1));
    const revoked = scriptedFetch(() => ({ status: 401, body: { code: "device_revoked", message: "x" } }));
    await createHttpAuth(createMobileApiClient(BASE, { fetch: revoked.fetch })).getSession().catch(() => undefined);
    expect(heard).toHaveLength(1);
    const plain = scriptedFetch(() => ({ status: 401, body: { code: "unauthenticated", message: "x" } }));
    await createHttpAuth(createMobileApiClient(BASE, { fetch: plain.fetch })).getSession().catch(() => undefined);
    expect(heard).toHaveLength(1);
    off();
    notifyDeviceRevoked();
    expect(heard).toHaveLength(1);
  });
});
