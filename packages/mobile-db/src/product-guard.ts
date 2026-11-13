import { getDraftItems, type ProductBlockReason } from "./local-orders";
import { cachedPriceTableCodes, customerPriceTableOf } from "./reference-cache";
import type { SqlExecutor, SqlRow } from "./connection";

/** A customer without a table is priced in this one (owner 2026-11-13). */
const DEFAULT_PRICE_TABLE = 5;

/**
 * Indicative check of a draft against the catalog on this device: a line whose product is not in the cache lost its mobility;
 * one with no price above zero in the customer's table lost its price. Mobility wins when both apply. With nothing downloaded
 * (empty catalog) nothing is judged: absence of data is not absence of mobility. The server revalidates on send (P-08).
 */
export async function productBlockOf(db: SqlExecutor, draftLocalId: string, customerCode: number): Promise<ProductBlockReason | null> {
  const count = Number((await db.query<SqlRow>("SELECT count(*) AS n FROM cache_product"))[0]?.n ?? 0);
  if (count === 0) return null;
  const items = await getDraftItems(db, draftLocalId);
  const table = (await customerPriceTableOf(db, customerCode)) ?? null;
  const tableCode = table ?? DEFAULT_PRICE_TABLE;
  const tableOnDevice = (await cachedPriceTableCodes(db)).includes(tableCode);
  let withoutPrice = false;
  for (const item of items) {
    const known = (await db.query<SqlRow>("SELECT json_extract(data, '$.listPrice.state') AS state FROM cache_product WHERE code = ?", [item.productCode]))[0];
    if (known === undefined) return "product_without_mobility";
    const state = tableOnDevice
      ? (await db.query<SqlRow>("SELECT json_extract(price_json, '$.state') AS state FROM cache_table_price WHERE table_code = ? AND product_code = ?", [tableCode, item.productCode]))[0]?.state
      : known.state;
    if (state !== "priced") withoutPrice = true;
  }
  return withoutPrice ? "product_without_price" : null;
}
