import type { IcmsOption } from "./customer-form";

/**
 * Names of the ICMS classifications come from the server (the backend exposes a list of `{ code, label }`; names are never invented
 * in the client). Until that endpoint is in `packages/contracts`, the list is empty: the select is not shown and the request carries
 * the default classification `R` ("Revendedor"), which the server also applies.
 */
export function useIcmsOptions(): readonly IcmsOption[] {
  return [];
}
