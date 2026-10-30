import type { ApiSchema } from "@salesforce/contracts/client";
import { canUseCommercial } from "@salesforce/contracts";
import { useQuery } from "@tanstack/react-query";
import { orderEntryConfigurationQueryOptions } from "./api-queries";
import { useApi } from "./app-context";

export type DiscountAuthorityMode = ApiSchema<"DiscountAuthorityMode">;

/**
 * D-M: in `erp` mode the discount/credit release belongs to Sankhya and every Sales Force approval surface (limits W-39,
 * approvals W-20, approval alerts) stays hidden. `undefined` while the configuration is unknown: nothing approval-related is
 * shown until the server says `force`. Convenience only; the server enforces.
 */
export function useDiscountAuthorityMode(role?: string): DiscountAuthorityMode | undefined {
  const api = useApi();
  const enabled = role !== undefined && canUseCommercial(role);
  const query = useQuery({ ...orderEntryConfigurationQueryOptions(api), enabled, staleTime: 60_000 });
  return enabled ? query.data?.sales.discountAuthorityMode : undefined;
}

/** Approval surfaces exist only when the installation runs the Force approval flow. */
export function approvalsEnabled(mode: DiscountAuthorityMode | undefined): boolean {
  return mode === "force";
}
