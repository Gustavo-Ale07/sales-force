import { indexSellerDiscountRules, resolveSellerDiscountLimit } from "@salesforce/domain";
import { listProductGroupTree, readSellerDiscountLimits, type SqlDatabase } from "@salesforce/mobile-db";
import type { ProductListItem } from "../data/ports";

/**
 * The product's discount ceiling as the seller's own rules resolve it (product > subgroup > group > general > DESCMAX), with the SAME
 * domain function the server uses. Without cached rules the product keeps its DESCMAX. Offline: reads only the local cache.
 */
export async function sellerLimitApplier(db: SqlDatabase): Promise<(product: ProductListItem) => ProductListItem> {
  const cached = await readSellerDiscountLimits(db);
  if (cached === null || cached.rules.length === 0) return (product) => product;
  const tree = await listProductGroupTree(db);
  const parents = new Map<number, number | null>((tree?.items ?? []).map((node) => [node.code, node.parentCode]));
  const rules = indexSellerDiscountRules(cached.rules);
  return (product) => {
    const resolved = resolveSellerDiscountLimit({
      productCode: product.code,
      groupCode: product.groupCode ?? null,
      erpMaxPercent: product.maxDiscountPercent ?? null,
      rules,
      parentOf: (code) => parents.get(code) ?? null,
    });
    return { ...product, maxDiscountPercent: resolved.limit };
  };
}
