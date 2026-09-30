import type { ProductRepository } from "../data/ports";
import { ProductBrowser } from "./product-browser";
import type { ProductOrderActions } from "./product-views";

export interface ProductPickerProps {
  readonly products: ProductRepository;
  readonly actions: ProductOrderActions;
  readonly onUnauthenticated: () => void;
}

/** Step 2 of the new-order flow: the shared catalog browser in selection mode (add, quantity, already in the cart). */
export function ProductPicker({ products, actions, onUnauthenticated }: ProductPickerProps) {
  return <ProductBrowser products={products} actions={actions} onUnauthenticated={onUnauthenticated} />;
}
