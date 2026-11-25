import { ApiRequestError } from "./api";
import { buildTemplateLines, describeTemplateError, isUnknownTemplateOutcome, templateItemsOf, templateSkipReasonLabels } from "./order-templates";
import type { ListPriceContext, ProductListItem, ProductRepository } from "./ports";
import { pageOf, product } from "../test-doubles";

const PRICED: ListPriceContext = { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 };

function repository(catalog: readonly ProductListItem[], pricedForCustomer: ReadonlySet<number>): ProductRepository {
  return {
    async list({ search, customerCode }) {
      const hits = catalog.filter((item) => (customerCode === undefined || pricedForCustomer.has(item.code)) && String(item.code).includes(search));
      return pageOf(hits);
    },
    async get(code) {
      return product(code);
    },
  };
}

describe("buildTemplateLines", () => {
  const catalog = [
    product(1, { listPrice: PRICED }),
    product(2, { listPrice: PRICED, active: false }),
    product(3, { listPrice: PRICED, sellable: false }),
    product(4),
    product(5, { listPrice: { state: "priced", unitPrice: "0.00", tableCode: 1, versionId: 1 } }),
  ];
  const priced = new Set([1, 2, 3, 5]);
  const orderable = (state: string) => state === "priced";

  it("keeps usable lines with the typed quantity and reports each left-out line with the site's reason", async () => {
    const items = [1, 2, 3, 4, 5, 99].map((productCode) => ({ productCode, quantity: productCode === 1 ? "2.5" : "1" }));
    const built = await buildTemplateLines(repository(catalog, priced), 7, items, orderable);
    expect(built.lines.map((line) => [line.productCode, line.quantityText])).toEqual([[1, "2,5"], [5, "1"]]);
    expect(built.skipped.map((line) => [line.productCode, line.reason])).toEqual([
      [2, "product_inactive"],
      [3, "product_not_sellable"],
      [4, "no_price"],
      [99, "product_removed"],
    ]);
    expect(templateSkipReasonLabels.no_price).toBe("Produto sem preço para este cliente");
  });
});

describe("templateItemsOf", () => {
  it("reads the typed quantities and refuses an invalid one", () => {
    expect(templateItemsOf([{ productCode: 1, quantityText: "2,5" }])).toEqual([{ productCode: 1, quantity: "2.5" }]);
    expect(templateItemsOf([{ productCode: 1, quantityText: "abc" }])).toBeNull();
  });
});

describe("template errors", () => {
  it("names the failures the screen treats specially", () => {
    expect(describeTemplateError(new ApiRequestError({ status: 409, message: "x", reason: "template_name_taken" })).reason).toBe("name_taken");
    expect(describeTemplateError(new ApiRequestError({ status: 409, message: "x", reason: "template_limit_reached" })).reason).toBe("limit_reached");
    expect(describeTemplateError(new ApiRequestError({ status: 0, message: "x" })).reason).toBe("network");
  });

  it("keeps the request id only when the outcome is unknown", () => {
    expect(isUnknownTemplateOutcome(new ApiRequestError({ status: 0, message: "x" }))).toBe(true);
    expect(isUnknownTemplateOutcome(new ApiRequestError({ status: 503, message: "x" }))).toBe(true);
    expect(isUnknownTemplateOutcome(new ApiRequestError({ status: 409, message: "x" }))).toBe(false);
  });
});
