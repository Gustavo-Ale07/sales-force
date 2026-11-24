import { EMPTY_SALES_FILTERS, filterOf, parseLocalDate, periodRange } from "./sales";

const now = new Date(2026, 8, 30, 15, 30); // 30/09/2026 15:30 local
const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

describe("periodRange (local creation date)", () => {
  it("has no bounds for 'all'", () => {
    expect(periodRange({ period: "all", customFrom: null, customTo: null }, now)).toEqual({});
  });

  it("covers today, the last 7 and the last 30 days including today, in local days", () => {
    expect(periodRange({ period: "today", customFrom: null, customTo: null }, now)).toEqual({ from: iso(2026, 9, 30), before: iso(2026, 10, 1) });
    expect(periodRange({ period: "7d", customFrom: null, customTo: null }, now)).toEqual({ from: iso(2026, 9, 24), before: iso(2026, 10, 1) });
    expect(periodRange({ period: "30d", customFrom: null, customTo: null }, now)).toEqual({ from: iso(2026, 9, 1), before: iso(2026, 10, 1) });
  });

  it("makes a custom range inclusive of its last day and ignores unreadable dates", () => {
    expect(periodRange({ period: "custom", customFrom: "2026-09-10", customTo: "2026-09-12" }, now)).toEqual({ from: iso(2026, 9, 10), before: iso(2026, 9, 13) });
    expect(periodRange({ period: "custom", customFrom: "2026-09-10", customTo: null }, now)).toEqual({ from: iso(2026, 9, 10) });
    expect(periodRange({ period: "custom", customFrom: "2026-13-40", customTo: "abc" }, now)).toEqual({});
  });
});

describe("parseLocalDate", () => {
  it("accepts only real calendar dates", () => {
    expect(parseLocalDate("2026-02-28")).not.toBeNull();
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("30/09/2026")).toBeNull();
  });
});

describe("filterOf (product and date-field filters)", () => {
  const base = { group: "unsent" as const, ...EMPTY_SALES_FILTERS };
  it("maps the products (at most 20) and the match, and the date field only with a period", () => {
    const products = Array.from({ length: 25 }, (_, index) => ({ code: index + 1, name: `P${index + 1}` }));
    const filter = filterOf("owner", { ...base, products, productMatch: "all", period: "today", dateField: "updatedAt" }, "", now, null);
    expect(filter.productCodes).toHaveLength(20);
    expect(filter.productMatch).toBe("all");
    expect(filter.dateField).toBe("updatedAt");
    const noPeriod = filterOf("owner", { ...base, dateField: "updatedAt" }, "", now, null);
    expect(noPeriod.dateField).toBeUndefined();
    expect(noPeriod.productCodes).toBeUndefined();
  });
});
