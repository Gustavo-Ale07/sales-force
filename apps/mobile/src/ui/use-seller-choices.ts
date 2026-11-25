import { useEffect, useState } from "react";
import type { SellerChoice } from "../data/customer-form";

/**
 * The sellers a user who is NOT a seller can link a new customer to. `null` for a seller (no field: the customer is linked to them).
 * Online: the active sellers from the server; without connection (or on failure) the sellers present in the portfolio on this device.
 * Only management profiles ever reach a non-null result; the server re-validates the link either way (P-21).
 */
export function useSellerChoices(options: {
  readonly isSeller: boolean;
  readonly enabled: boolean;
  readonly loadActive?: () => Promise<readonly SellerChoice[]>;
  readonly loadLocal?: () => Promise<readonly { readonly code: number; readonly name: string | null }[]>;
}): readonly SellerChoice[] | null {
  const { isSeller, enabled, loadActive, loadLocal } = options;
  const [choices, setChoices] = useState<readonly SellerChoice[]>([]);
  useEffect(() => {
    if (isSeller || !enabled) return;
    let current = true;
    const fromLocal = async () => (loadLocal === undefined ? [] : (await loadLocal()).map((s) => ({ code: s.code, name: s.name ?? `Vendedor ${s.code}` })));
    (loadActive === undefined ? fromLocal() : loadActive().catch(fromLocal))
      .then((list) => {
        if (current) setChoices(list);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [isSeller, enabled, loadActive, loadLocal]);
  return isSeller ? null : choices;
}
