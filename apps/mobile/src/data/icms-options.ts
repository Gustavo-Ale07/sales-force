import type { IcmsClassificationOption } from "./customer-form";

/**
 * Names of the ICMS classifications come from the server (a list of `{ code, label }`); they are never invented in the client.
 * Until that list is in `packages/contracts` it is empty: the selector is not shown and the request carries the default `R`
 * ("Revendedor"), which the server also applies. Wire the contract's call here (same name as the site's `useIcmsOptions`).
 */
const NO_OPTIONS: readonly IcmsClassificationOption[] = [];

export function useIcmsOptions(): readonly IcmsClassificationOption[] {
  return NO_OPTIONS;
}
