import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ProductImageStore } from "./image-store";

interface ProductImageContextValue {
  readonly store: ProductImageStore | null;
  /** False only when the device is known to be offline: no network attempt, stored files only. */
  readonly online: boolean;
}

const ProductImageContext = createContext<ProductImageContextValue>({ store: null, online: true });

/** Gives every product row the signed-in account's thumbnail store. Without a provider the rows show initials only. */
export function ProductImageProvider({ store, online, children }: { store: ProductImageStore | null; online: boolean; children: ReactNode }) {
  const value = useMemo(() => ({ store, online }), [store, online]);
  return <ProductImageContext.Provider value={value}>{children}</ProductImageContext.Provider>;
}

export function useProductImages(): ProductImageContextValue {
  return useContext(ProductImageContext);
}
