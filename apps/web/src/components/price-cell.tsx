import { Badge, Money } from "@salesforce/ui";
import { noPriceReasonLabels } from "../lib/labels";
import type { ListPrice } from "../lib/price-types";

export const NO_PRICE_TEXT = "Sem preço";

/**
 * List price of a product. A missing price is "Sem preço", never zero (CFG-5); an explicit zero row is shown as a
 * zero value with a distinct marker so it is never confused with a missing price.
 */
export function PriceCell({ price }: { price: ListPrice }) {
  if (price.state === "none") {
    return <Money value={null} fallback={NO_PRICE_TEXT} title={noPriceReasonLabels[price.noPriceReason]} />;
  }
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {price.state === "zero" ? <Badge tone="warning">Preço zero</Badge> : null}
      <Money value={price.unitPrice} minFractionDigits={2} maxFractionDigits={6} />
    </span>
  );
}
