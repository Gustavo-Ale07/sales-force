import { evaluateOfflineAccess, effectiveOfflineMaxDays, type RememberedSession } from "./session";

const account = { id: "0190a0c0-0000-7000-8000-000000000001", username: "ana", displayName: "Ana", role: "seller" as const, sellerCodes: [7] };

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

  it("uses the days reported by the server", () => {
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
