import type { ApiSchema } from "@salesforce/contracts/client";
import { describe, expect, it } from "vitest";
import { noPriceList, product } from "../test/fixtures";
import {
  MAX_ENTRY_CHARS,
  MAX_ENTRY_ROWS,
  MAX_ORDER_ROWS,
  identifiersToResolve,
  parseBulkEntry,
  planEntry,
  type EntryRow,
} from "./bulk-entry";

describe("parseBulkEntry", () => {
  it("reads code;quantity lines with the pt-BR decimal comma", () => {
    const result = parseBulkEntry("2001;5\n2002;2,5\n");
    expect(result).toEqual({
      ok: true,
      rows: [
        { line: 1, identifier: "2001", quantityText: "5", problem: null },
        { line: 2, identifier: "2002", quantityText: "2,5", problem: null },
      ],
      skipped: 0,
    });
  });

  it("strips C0, DEL and C1 control characters, as the API rejects them", () => {
    const result = parseBulkEntry("AB\u0085C\u007f-1;2");
    expect(result.ok && result.rows.map((row) => [row.identifier, row.quantityText, row.problem])).toEqual([["ABC-1", "2", null]]);
  });

  it("accepts tabs (pasted from a spreadsheet), CRLF, blank lines and quoted fields", () => {
    const result = parseBulkEntry('"ABC-1"\t3\r\n\r\n  ref 9 ;  4  \r\n');
    expect(result.ok && result.rows.map((row) => [row.line, row.identifier, row.quantityText])).toEqual([
      [1, "ABC-1", "3"],
      [3, "ref 9", "4"],
    ]);
  });

  it("uses quantity 1 when the line has only the identifier", () => {
    const result = parseBulkEntry("2001\n");
    expect(result.ok && result.rows[0]).toMatchObject({
      identifier: "2001",
      quantityText: "1",
      problem: null,
    });
  });

  it("skips a header line naming the quantity column", () => {
    const result = parseBulkEntry("Código;Quantidade\n2001;5");
    expect(result.ok && result.rows).toEqual([{ line: 2, identifier: "2001", quantityText: "5", problem: null }]);
  });

  it("keeps invalid quantities as row problems instead of dropping them", () => {
    const result = parseBulkEntry("2001;0\n2002;2.5\n2003;abc\n2004;");
    expect(result.ok && result.rows.map((row) => row.problem)).toEqual(["not_positive", "dot_separator", "not_a_decimal", "empty"]);
  });

  it("flags an identifier longer than the API accepts", () => {
    const result = parseBulkEntry(`${"9".repeat(41)};1`);
    expect(result.ok && result.rows[0]?.problem).toBe("identifier_too_long");
  });

  it("does not mix extra columns into the quantity", () => {
    const result = parseBulkEntry("2001;5;observação");
    expect(result.ok && result.rows[0]).toMatchObject({ identifier: "2001", quantityText: "5" });
  });

  it("keeps hostile identifiers as inert text", () => {
    const result = parseBulkEntry("__proto__;1\nconstructor;1\n<img src=x onerror=1>;2");
    expect(result.ok && result.rows.map((row) => row.identifier)).toEqual(["__proto__", "constructor", "<img src=x onerror=1>"]);
  });

  it("reports an empty paste", () => {
    expect(parseBulkEntry("  \n\n")).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses an input above the size limit before reading it", () => {
    expect(parseBulkEntry("x".repeat(MAX_ENTRY_CHARS + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("refuses more lines than the import limit before reading them", () => {
    expect(parseBulkEntry("1\n".repeat(MAX_ENTRY_ROWS + 1))).toEqual({
      ok: false,
      reason: "too_many_rows",
    });
  });

  it("keeps only the first rows an order can hold and says how many were left out", () => {
    const text = Array.from({ length: MAX_ORDER_ROWS + 3 }, (_, index) => `${index + 1};1`).join("\n");
    const result = parseBulkEntry(text);
    expect(result.ok && result.rows).toHaveLength(MAX_ORDER_ROWS);
    expect(result.ok && result.skipped).toBe(3);
  });
});

describe("planEntry", () => {
  const rowOf = (identifier: string, quantityText = "1", line = 1): EntryRow => ({ line, identifier, quantityText, problem: null });
  const found = (identifier: string, item = product()): ApiSchema<"ProductResolutionItem"> => ({
    identifier,
    status: "found",
    product: item,
  });
  const context = { existingCodes: new Set<number>(), isPriceOrderable: () => true };

  it("adds resolved rows and resolves only the rows without a problem", () => {
    const rows = [rowOf("2001", "2", 1), { ...rowOf("x", "0", 2), problem: "not_positive" as const }, rowOf("2002", "1", 3)];
    expect(identifiersToResolve(rows)).toEqual(["2001", "2002"]);
    const plan = planEntry(rows, [found("2001"), found("2002", product({ code: 2002 }))], context);
    expect(plan.map((entry) => entry.skip)).toEqual([null, "not_positive", null]);
    expect(plan[0]?.product?.code).toBe(2001);
  });

  it("never adds the same product twice and does not add the ones already in the order", () => {
    const plan = planEntry(
      [rowOf("2001"), rowOf("BL-09-VM"), rowOf("2002")],
      [found("2001"), found("BL-09-VM"), found("2002", product({ code: 2002 }))],
      { ...context, existingCodes: new Set([2002]) },
    );
    expect(plan.map((entry) => entry.skip)).toEqual([null, "duplicate_in_file", "already_in_order"]);
  });

  it("keeps not found and ambiguous rows out, with the candidates for the second", () => {
    const candidates = [product({ code: 1 }), product({ code: 2 })];
    const plan = planEntry(
      [rowOf("nada"), rowOf("amb")],
      [
        { identifier: "nada", status: "not_found" },
        { identifier: "amb", status: "ambiguous", candidates },
      ],
      context,
    );
    expect(plan.map((entry) => entry.skip)).toEqual(["not_found", "ambiguous"]);
    expect(plan[1]?.candidates.map((candidate) => candidate.code)).toEqual([1, 2]);
  });

  it("keeps out products that cannot be sold and prices the installation does not let through", () => {
    const plan = planEntry(
      [rowOf("1"), rowOf("2")],
      [found("1", product({ code: 1, sellable: false })), found("2", product({ code: 2, listPrice: noPriceList("no_price_row") }))],
      { ...context, isPriceOrderable: (state) => state !== "none" },
    );
    expect(plan.map((entry) => entry.skip)).toEqual(["not_sellable", "price_blocked"]);
  });

  it("does not trust a response that does not match the request", () => {
    expect(() => planEntry([rowOf("1"), rowOf("2")], [found("1")], context)).toThrow(/resposta/i);
    expect(() => planEntry([rowOf("1")], [found("9")], context)).toThrow(/resposta/i);
  });

  it("plans without resolutions when there is nothing to resolve", () => {
    const plan = planEntry([{ ...rowOf("x", "abc"), problem: "not_a_decimal" }], [], context);
    expect(plan[0]?.skip).toBe("not_a_decimal");
  });
});
