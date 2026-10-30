import { ApiRequestError } from "./api";
import { describeDuplicateFailure, describeSkippedLines, isQuotationTop, sellableNegotiationTypes, topLabel, topOptions } from "./order-header";

const tops = { defaultTopCode: 1001, quotationTopCode: 1000, eligibleTopCodes: [1000, 1001, 1002] };

describe("sellableNegotiationTypes", () => {
  it("hides the types flagged sellable: false and keeps unflagged ones", () => {
    const result = sellableNegotiationTypes([
      { code: 1, label: "À vista", sellable: true },
      { code: 2, label: "Antigo", sellable: false },
      { code: 3, label: "30 dias" },
    ]);
    expect(result.map((t) => t.code)).toEqual([1, 3]);
  });
});

describe("TOP options", () => {
  it("labels the default order TOP, the quotation TOP and any other", () => {
    expect(topLabel(1001, tops)).toBe("Pedido (TOP 1001)");
    expect(topLabel(1000, tops)).toBe("Cotação (TOP 1000)");
    expect(topLabel(1002, tops)).toBe("TOP 1002");
  });

  it("lists the default first, then the quotation, then the rest", () => {
    expect(topOptions(tops).map((o) => o.code)).toEqual([1001, 1000, 1002]);
  });

  it("offers no choice when fewer than two TOPs are eligible", () => {
    expect(topOptions({ ...tops, eligibleTopCodes: [1001] })).toEqual([]);
    expect(topOptions({ ...tops, eligibleTopCodes: [] })).toEqual([]);
  });

  it("recognizes the quotation TOP, never when it is not configured", () => {
    expect(isQuotationTop(1000, tops)).toBe(true);
    expect(isQuotationTop(1001, tops)).toBe(false);
    expect(isQuotationTop(null, tops)).toBe(false);
    expect(isQuotationTop(1000, { ...tops, quotationTopCode: null })).toBe(false);
  });
});

describe("describeDuplicateFailure", () => {
  const conflict = (reason: string, skippedLines: { lineNo: number; productCode: number; reason: string }[] = []) =>
    new ApiRequestError({ status: 409, code: "conflict", message: "x", reason, skippedLines });

  it.each([
    ["not_a_quotation", /não é uma cotação/],
    ["source_cancelled", /cancelada/],
    ["order_top_not_configured", /não foi configurada/],
    ["no_usable_lines", /Nenhum item/],
  ])("explains the 409 reason %s", (reason, pattern) => {
    expect(describeDuplicateFailure(conflict(reason)).message).toMatch(pattern);
  });

  it("lists the skipped lines of no_usable_lines", () => {
    const failure = describeDuplicateFailure(conflict("no_usable_lines", [{ lineNo: 1, productCode: 12, reason: "no_price" }]));
    expect(failure.skipped).toEqual(["Produto 12 (sem preço)"]);
  });

  it("explains network and unknown failures without technical text", () => {
    expect(describeDuplicateFailure(new ApiRequestError({ status: 0, message: "x" })).message).toMatch(/Sem conexão/);
    expect(describeDuplicateFailure(new Error("boom")).message).toBe("Tente novamente em instantes.");
  });

  it("never says ERP", () => {
    for (const reason of ["not_a_quotation", "source_cancelled", "order_top_not_configured", "no_usable_lines", "dataset_mismatch"]) {
      expect(JSON.stringify(describeDuplicateFailure(conflict(reason)))).not.toMatch(/ERP/);
    }
  });
});

describe("describeSkippedLines", () => {
  it("names the reason in Portuguese and falls back for an unknown one", () => {
    expect(describeSkippedLines([{ productCode: 3, reason: "product_not_sellable" }, { productCode: 4, reason: "novo" }])).toEqual([
      "Produto 3 (produto indisponível para venda)",
      "Produto 4 (não pôde ser copiado)",
    ]);
  });
});
