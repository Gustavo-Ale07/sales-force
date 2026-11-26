import { listProductGroupTree, readSellerDiscountLimits, type SqlDatabase } from "@salesforce/mobile-db";
import type { ProductListItem } from "../data/ports";
import { sellerLimitApplier } from "./seller-discount-limit";

jest.mock("@salesforce/mobile-db", () => ({
  ...jest.requireActual("@salesforce/mobile-db"),
  readSellerDiscountLimits: jest.fn(),
  listProductGroupTree: jest.fn(),
}));

const rulesOf = readSellerDiscountLimits as jest.MockedFunction<typeof readSellerDiscountLimits>;
const treeOf = listProductGroupTree as jest.MockedFunction<typeof listProductGroupTree>;
const db = {} as SqlDatabase;

/** Pai (10) > Filho (11) > Neto (12). */
const node = (code: number, parentCode: number | null) => ({ code, name: `G${code}`, parentCode, degree: 1, hasChildren: false, subtreeCodes: [code] });
const tree = { items: [node(10, null), node(11, 10), node(12, 11)], hierarchical: true, hasUngrouped: false };
const product = (extra: Partial<ProductListItem>) => ({ code: 1, groupCode: 12, maxDiscountPercent: "5", ...extra }) as unknown as ProductListItem;

beforeEach(() => {
  treeOf.mockReset().mockResolvedValue(tree as never);
  rulesOf.mockReset();
});

async function limitOf(rules: { kind: "general" | "group" | "product"; code: number | null; percent: string }[], item: ProductListItem) {
  rulesOf.mockResolvedValue({ sellerCode: 103, rules });
  return (await sellerLimitApplier(db))(item).maxDiscountPercent;
}

describe("seller discount limit on the device (same domain resolver as the server)", () => {
  it("without cached rules the product keeps its own ceiling", async () => {
    rulesOf.mockResolvedValue(null);
    expect((await sellerLimitApplier(db))(product({})).maxDiscountPercent).toBe("5");
  });

  it("product rule wins over everything", async () => {
    const rules = [{ kind: "product" as const, code: 1, percent: "3" }, { kind: "group" as const, code: 12, percent: "9" }, { kind: "general" as const, code: null, percent: "7" }];
    expect(await limitOf(rules, product({}))).toBe("3");
  });

  it("the nearest ancestor group wins, 3 levels deep (child over parent)", async () => {
    expect(await limitOf([{ kind: "group", code: 10, percent: "20" }], product({}))).toBe("20");
    expect(await limitOf([{ kind: "group", code: 10, percent: "20" }, { kind: "group", code: 11, percent: "15" }], product({}))).toBe("15");
  });

  it("falls to the general limit, then to the product ceiling, then to none", async () => {
    expect(await limitOf([{ kind: "general", code: null, percent: "7" }], product({ groupCode: 99 }))).toBe("7");
    expect(await limitOf([{ kind: "group", code: 40, percent: "2" }], product({ groupCode: 99 }))).toBe("5");
    expect(await limitOf([{ kind: "group", code: 40, percent: "2" }], product({ groupCode: 99, maxDiscountPercent: null }))).toBeNull();
  });

  it("zero is a real limit", async () => {
    expect(await limitOf([{ kind: "general", code: null, percent: "0" }], product({}))).toBe("0");
  });
});
