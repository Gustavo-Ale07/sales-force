import { getMeta, setMeta, type SqlDatabase } from "@salesforce/mobile-db";
import { ApiRequestError } from "../data/api";
import { moneyText, percentText, positivationText } from "../ui/goals-screen";
import { tasksDueToday } from "../ui/home-screen";
import { createGoalsPort, goalsCacheKey } from "./goals-service";

jest.mock("@salesforce/mobile-db", () => ({
  ...jest.requireActual("@salesforce/mobile-db"),
  getMeta: jest.fn(),
  setMeta: jest.fn(),
}));

const read = getMeta as jest.MockedFunction<typeof getMeta>;
const write = setMeta as jest.MockedFunction<typeof setMeta>;
const now = () => new Date("2026-11-26T12:00:00Z");
const data = {
  month: "2026-11",
  goalsSyncedAt: null,
  salesSyncedAt: null,
  total: {
    revenue: { target: "1000.00", realized: "250.00", percent: "25" },
    quantity: { target: "10", realized: null, percent: null },
    positivation: { positivated: 2, total: 8, percent: "25" },
  },
  bySeller: [],
};

function port(get: () => Promise<unknown>) {
  const api = { GET: get } as never;
  return createGoalsPort({ db: {} as SqlDatabase, api, ownerAccountId: "acct-1", now });
}

beforeEach(() => {
  read.mockReset().mockResolvedValue(null);
  write.mockReset().mockResolvedValue(undefined);
});

describe("goals cache (DSH-5 / M-24)", () => {
  it("stores the server answer under the per-account cache key", async () => {
    const snapshot = await port(async () => ({ data, response: { ok: true, status: 200 } })).load();
    expect(snapshot?.data.month).toBe("2026-11");
    expect(write).toHaveBeenCalledWith(expect.anything(), goalsCacheKey("acct-1"), expect.stringContaining('"fetchedAt"'), expect.any(String));
    expect(goalsCacheKey("acct-1")).toMatch(/^cache\./);
  });

  it("falls back to the stored value when there is no connection", async () => {
    read.mockResolvedValue(JSON.stringify({ data, fetchedAt: "2026-11-25T10:00:00.000Z" }));
    const snapshot = await port(async () => {
      throw new ApiRequestError({ status: 0, message: "x" });
    }).load();
    expect(snapshot?.fetchedAt).toBe("2026-11-25T10:00:00.000Z");
  });

  it("returns null with nothing stored and ignores a corrupt entry", async () => {
    read.mockResolvedValue("{not json");
    expect(await port(async () => { throw new Error("x"); }).load()).toBeNull();
  });
});

describe("formatting and tasks of the day", () => {
  it("shows missing figures as a dash, never zero", () => {
    expect(moneyText(null)).toBe("—");
    expect(percentText(null)).toBe("—");
    expect(positivationText(null)).toBe("—");
    expect(positivationText({ positivated: 2, total: 8, percent: "66.7" })).toBe("2 de 8 (66,7%)");
  });

  it("counts only pending tasks due by the end of today", () => {
    const at = new Date(2026, 10, 26, 10, 0, 0);
    const items = [
      { status: "pending", dueAt: new Date(2026, 10, 26, 15, 0).toISOString() },
      { status: "pending", dueAt: new Date(2026, 10, 20, 9, 0).toISOString() },
      { status: "pending", dueAt: new Date(2026, 10, 27, 9, 0).toISOString() },
      { status: "completed", dueAt: new Date(2026, 10, 26, 9, 0).toISOString() },
    ];
    expect(tasksDueToday(items, at)).toBe(2);
  });
});
