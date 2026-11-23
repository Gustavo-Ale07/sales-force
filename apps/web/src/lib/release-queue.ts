import { canUseCommercial } from "@salesforce/contracts";
import { useQuery } from "@tanstack/react-query";
import { releaseQueueCountQueryOptions } from "./api-queries";
import { useApi } from "./app-context";
import { isOperationsRole } from "./operations-role";

/**
 * Whether the signed-in profile gets the "Aguardando liberação" menu item, and its counter. The answer is the API's own:
 * the count endpoint answers 403 to a profile that sees no sector, and any failure keeps the item hidden. Hiding is
 * convenience only; the list endpoint enforces the same rule.
 */
export function useReleaseQueueAccess(role: string | undefined) {
  const api = useApi();
  const query = useQuery({ ...releaseQueueCountQueryOptions(api), enabled: role !== undefined && (canUseCommercial(role) || isOperationsRole(role)) });
  return { visible: query.isSuccess, total: query.data?.total ?? 0, data: query.data };
}

/** Waiting time as pt-BR text from whole minutes: "menos de 1 min", "45 min", "2 h 15 min", "3 d 4 h". */
export function formatWaiting(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 1) return "menos de 1 min";
  if (total < 60) return `${total} min`;
  if (total < 1440) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}
