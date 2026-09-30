import type { ConnectivityState } from "../connectivity/connectivity";
import type { ProductRepository } from "../data/ports";
import { ProductBrowser } from "./product-browser";

export interface ProductsScreenProps {
  readonly products: ProductRepository;
  readonly onUnauthenticated: () => void;
  readonly connectivity?: ConnectivityState;
}

/**
 * Catálogo tab: read-only consultation (no customer, no cart) of the products on the device, with the list price of
 * the catalog reference table. The price for a customer is resolved inside Novo pedido and revalidated by the server.
 */
export function ProductsScreen({ products, onUnauthenticated, connectivity }: ProductsScreenProps) {
  return <ProductBrowser title="Catálogo" products={products} onUnauthenticated={onUnauthenticated} connectivity={connectivity} />;
}
