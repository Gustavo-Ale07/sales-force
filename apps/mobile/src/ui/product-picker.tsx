import type { ProductRepository } from "../data/ports";
import { ProductBrowser } from "./product-browser";
import type { ProductOrderActions } from "./product-views";

export interface ProductPickerProps {
  readonly products: ProductRepository;
  /** The order customer: the catalog is the one of this customer's price table (only products with a price above zero). */
  readonly customerCode?: number | undefined;
  readonly actions: ProductOrderActions;
  readonly onUnauthenticated: () => void;
}

/** Step 2 of the new-order flow: the shared catalog browser in selection mode (add, quantity, already in the cart). */
export function ProductPicker({ products, customerCode, actions, onUnauthenticated }: ProductPickerProps) {
  return <ProductBrowser products={products} customerCode={customerCode} actions={actions} onUnauthenticated={onUnauthenticated} />;
}
