import { describe, expect, it } from "vitest";
import { formatWaiting } from "./release-queue";
import { parseReleaseQueueSearch } from "./route-search";

describe("formatWaiting", () => {
  it.each([
    [0, "menos de 1 min"],
    [0.9, "menos de 1 min"],
    [-5, "menos de 1 min"],
    [1, "1 min"],
    [59, "59 min"],
    [60, "1 h"],
    [61, "1 h 1 min"],
    [135, "2 h 15 min"],
    [1439, "23 h 59 min"],
    [1440, "1 d"],
    [1500, "1 d 1 h"],
    [1499, "1 d"],
    [4440, "3 d 2 h"],
    [4560, "3 d 4 h"],
  ])("%s min -> %s", (minutes, text) => {
    expect(formatWaiting(minutes)).toBe(text);
  });
});

describe("parseReleaseQueueSearch", () => {
  it("returns nothing for an empty URL, keeping defaults out of it", () => {
    expect(parseReleaseQueueSearch({})).toEqual({});
    expect(parseReleaseQueueSearch({ page: 1, pageSize: 25 })).toEqual({});
  });

  it("keeps valid values, trimming the sector and accepting numeric strings", () => {
    expect(parseReleaseQueueSearch({ sector: " Financeiro ", sellerCode: "7", page: "3", pageSize: 50 })).toEqual({
      sector: "Financeiro",
      sellerCode: 7,
      page: 3,
      pageSize: 50,
    });
  });

  it("drops invalid values instead of passing them to the API", () => {
    expect(
      parseReleaseQueueSearch({ sector: "x".repeat(61), sellerCode: -1, page: 0, pageSize: 37 }),
    ).toEqual({});
    expect(parseReleaseQueueSearch({ sector: "   ", sellerCode: "abc", page: 1.5, pageSize: "1000" })).toEqual({});
    expect(parseReleaseQueueSearch({ sector: { a: 1 }, sellerCode: [1], page: null, pageSize: true })).toEqual({});
    expect(parseReleaseQueueSearch({ sellerCode: "7; DROP", page: "-2" })).toEqual({});
  });

  it("accepts sellerCode 0 as a valid code", () => {
    expect(parseReleaseQueueSearch({ sellerCode: 0 })).toEqual({ sellerCode: 0 });
  });
});
