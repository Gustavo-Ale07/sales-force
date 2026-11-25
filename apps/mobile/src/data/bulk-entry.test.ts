import { identifiersToResolve, parseBulkEntry, planEntry, resolveIdentifiers, MAX_ORDER_ROWS, type Resolution } from "./bulk-entry";
import type { ListPriceContext, ProductListItem, ProductRepository } from "./ports";

const PRICED: ListPriceContext = { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 };

function product(code: number, reference: string | null, overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    code,
    description: `Produto ${code}`,
    active: true,
    sellable: true,
    unit: "UN",
    brand: null,
    reference,
    groupCode: null,
    groupName: null,
    listPrice: PRICED,
    ...overrides,
  } as ProductListItem;
}

function repository(catalog: readonly ProductListItem[], pricedForCustomer: ReadonlySet<number>): ProductRepository {
  return {
    async list({ search, customerCode, page, pageSize }) {
      const all = catalog.filter(
        (item) => (customerCode === undefined || pricedForCustomer.has(item.code)) && (String(item.code).includes(search) || (item.reference ?? "").includes(search)),
      );
      return { items: all.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: all.length };
    },
    async get() {
      throw new Error("not used");
    },
  };
}

describe("parseBulkEntry", () => {
  it("reads code;quantity lines, with header, tabs, quotes and a bare code meaning 1", () => {
    const parsed = parseBulkEntry('codigo;qtd\n2001;5\n"BL-09";2,5\n\n3003\t7\n4004');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.map((row) => [row.line, row.identifier, row.quantityText, row.problem])).toEqual([
      [2, "2001", "5", null],
      [3, "BL-09", "2,5", null],
      [5, "3003", "7", null],
      [6, "4004", "1", null],
    ]);
  });

  it("flags a bad quantity and a long identifier on the row, never drops it", () => {
    const parsed = parseBulkEntry(`2001;0\n2002;abc\n${"x".repeat(41)};1`);
    expect(parsed.ok && parsed.rows.map((row) => row.problem)).toEqual(["not_positive", "not_a_decimal", "identifier_too_long"]);
  });

  it("reports empty content and caps one order at 500 rows", () => {
    expect(parseBulkEntry("  \n \n")).toEqual({ ok: false, reason: "empty" });
    const many = Array.from({ length: MAX_ORDER_ROWS + 3 }, (_, index) => `${index + 1};1`).join("\n");
    const parsed = parseBulkEntry(many);
    expect(parsed.ok && [parsed.rows.length, parsed.skipped]).toEqual([MAX_ORDER_ROWS, 3]);
  });
});

describe("planEntry", () => {
  const context = { existingCodes: new Set([9]), isPriceOrderable: (state: string) => state === "priced" };

  it("leaves out, with a reason each: problems, unknown, ambiguous, in order, repeated and unpriced", () => {
    const parsed = parseBulkEntry("1;1\n2;0\n3;1\n4;1\n9;1\n1;2\n5;1\n6;1");
    if (!parsed.ok) throw new Error("parse");
    const resolutions: Resolution[] = [
      { identifier: "1", status: "found", product: product(1, null) },
      { identifier: "3", status: "not_found" },
      { identifier: "4", status: "ambiguous", candidates: [product(41, "4"), product(42, "4")] },
      { identifier: "9", status: "found", product: product(9, null) },
      { identifier: "1", status: "found", product: product(1, null) },
      { identifier: "5", status: "found", product: product(5, null, { listPrice: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" } }) },
      { identifier: "6", status: "found", product: product(6, null) },
    ];
    expect(identifiersToResolve(parsed.rows)).toEqual(["1", "3", "4", "9", "1", "5", "6"]);
    expect(planEntry(parsed.rows, resolutions, context).map((entry) => entry.skip)).toEqual([
      null,
      "not_positive",
      "not_found",
      "ambiguous",
      "already_in_order",
      "duplicate_in_file",
      "price_blocked",
      null,
    ]);
  });

  it("refuses a resolution that does not answer the rows sent", () => {
    const parsed = parseBulkEntry("1;1");
    if (!parsed.ok) throw new Error("parse");
    expect(() => planEntry(parsed.rows, [], context)).toThrow();
  });
});

describe("resolveIdentifiers (device catalog)", () => {
  const catalog = [product(7, "ABC"), product(70, "X-70"), product(71, "7"), product(80, "DUP"), product(81, "DUP"), product(90, "NOPRICE")];
  const priced = new Set([7, 70, 71, 80, 81]);
  const products = repository(catalog, priced);

  it("matches the code (digits, no leading zero) or the reference exactly, never by part", async () => {
    const answers = await resolveIdentifiers(products, 5, ["7", "ABC", "007", "X-7"]);
    expect(answers.map((answer) => answer.status)).toEqual(["ambiguous", "found", "not_found", "not_found"]);
    expect(answers[0]?.candidates?.map((candidate) => candidate.code)).toEqual([7, 71]);
    expect(answers[1]?.product?.code).toBe(7);
  });

  it("is ambiguous when two products share a reference", async () => {
    const [answer] = await resolveIdentifiers(products, 5, ["DUP"]);
    expect(answer?.status).toBe("ambiguous");
  });

  it("reports a product without a price in the customer table as found, with no price (never a guessed one)", async () => {
    const [answer] = await resolveIdentifiers(products, 5, ["NOPRICE"]);
    expect(answer?.status).toBe("found");
    expect(answer?.product?.listPrice.state).toBe("none");
  });

  it("answers a repeated identifier at each position, in order", async () => {
    const answers = await resolveIdentifiers(products, 5, ["ABC", "nada", "ABC"]);
    expect(answers.map((answer) => [answer.identifier, answer.status])).toEqual([["ABC", "found"], ["nada", "not_found"], ["ABC", "found"]]);
  });
});
