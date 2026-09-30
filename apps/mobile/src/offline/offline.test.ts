import type { DraftItemRecord, SyncStatus } from "@salesforce/mobile-db";
import { ApiRequestError } from "../data/api";
import { lineFromProduct } from "../data/order-draft";
import { account, product } from "../test-doubles";
import { linesFromDraftItems, toDraftItems } from "./local-orders";
import { MAX_OFFLINE_DAYS, evaluateOfflineAccess } from "./session";
import { describeSyncStatus } from "./sync-status-text";
import { toTransportError } from "./transport";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

describe("toTransportError", () => {
  const kindOf = (init: ConstructorParameters<typeof ApiRequestError>[0]) => toTransportError(new ApiRequestError(init)).kind;

  it("classifies the failures the sync engine treats differently", () => {
    expect(kindOf({ status: 0, message: "x" })).toBe("network");
    expect(kindOf({ status: 409, code: "version_conflict", message: "x" })).toBe("version_conflict");
    expect(kindOf({ status: 409, code: "order_not_editable", message: "x" })).toBe("not_editable");
    expect(kindOf({ status: 409, code: "idempotency_conflict", message: "x" })).toBe("idempotency_conflict");
    expect(kindOf({ status: 401, message: "x" })).toBe("auth");
    expect(kindOf({ status: 429, message: "x" })).toBe("rate_limit");
    expect(kindOf({ status: 503, message: "x" })).toBe("server");
    expect(kindOf({ status: 422, message: "x" })).toBe("validation");
  });

  it("never lets a raw technical message reach the seller for validation failures", () => {
    const error = toTransportError(new ApiRequestError({ status: 422, message: "Network request failed" }));
    expect(error.message).not.toMatch(/Network request failed/);
  });
});

describe("offline session gate", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("allows a remembered account inside the offline window", () => {
    const access = evaluateOfflineAccess({ account, lastOnlineAt: daysAgo(MAX_OFFLINE_DAYS - 1) }, now);
    expect(access.allowed).toBe(true);
  });

  it("refuses an expired or missing remembered account", () => {
    expect(evaluateOfflineAccess({ account, lastOnlineAt: daysAgo(MAX_OFFLINE_DAYS + 1) }, now)).toEqual({ allowed: false, reason: "expired" });
    expect(evaluateOfflineAccess(null, now)).toEqual({ allowed: false, reason: "none" });
    expect(evaluateOfflineAccess({ account, lastOnlineAt: "not a date" }, now)).toEqual({ allowed: false, reason: "expired" });
  });
});

describe("describeSyncStatus", () => {
  it("uses the wording the seller sees, never a technical error", () => {
    expect(describeSyncStatus({ ...idle, phase: "syncing" }, "online").text).toBe("Sincronizando...");
    expect(describeSyncStatus(idle, "online").text).toBe("✓ Sincronizado");
    expect(describeSyncStatus({ ...idle, pending: 2 }, "online").text).toBe("↑ Alterações pendentes (2)");
    expect(describeSyncStatus({ ...idle, pending: 2 }, "offline").text).toBe("Sem conexão — alterações salvas neste dispositivo");
    expect(describeSyncStatus({ ...idle, phase: "error", lastError: "Network request failed" }, "online").text).toBe("Erro ao sincronizar");
  });
});

describe("editor line <-> stored draft item", () => {
  it("keeps quantity, discount, price context and group across a save/reopen", () => {
    const priced = product(5, {
      description: "Copo 200 ml",
      groupCode: 3,
      groupName: "Descartáveis",
      listPrice: { state: "priced", unitPrice: "12.500000", tableCode: 1, versionId: 9 },
    });
    const line = { ...lineFromProduct(priced, "k1"), quantityText: "2,5", discountText: "10" };
    const [stored] = toDraftItems([line]);
    expect(stored).toMatchObject({ productCode: 5, quantity: "2.5", discountPercent: "10", groupCode: 3 });

    const record = { ...stored!, position: 0 } as DraftItemRecord;
    const [reopened] = linesFromDraftItems([record]);
    expect(reopened).toMatchObject({ productCode: 5, quantityText: "2,5", discountText: "10", group: { code: 3, name: "Descartáveis" } });
    expect(reopened!.price).toEqual(priced.listPrice);
  });

  it("stores no discount for a line without a price (P-09)", () => {
    const [stored] = toDraftItems([{ ...lineFromProduct(product(6), "k2"), discountText: "15" }]);
    expect(stored!.discountPercent).toBe("0");
  });

  it("rejects an invalid quantity instead of storing it", () => {
    expect(() => toDraftItems([{ ...lineFromProduct(product(7), "k3"), quantityText: "abc" }])).toThrow();
  });
});
