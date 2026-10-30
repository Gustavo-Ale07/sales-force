import { EmptyState, SkeletonLines } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { ShieldOff } from "lucide-react";
import type { ReactNode } from "react";
import { orderEntryConfigurationQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { QueryError } from "./query-error";

/**
 * D-M: the Sales Force approval screens (W-20, W-39) exist only in `force` mode. In `erp` mode the release of discounts
 * belongs to Sankhya, so the route shows a plain explanation instead. The server enforces the mode as well.
 */
export function ForceModeGate({ children }: { children: ReactNode }) {
  const api = useApi();
  const query = useQuery(orderEntryConfigurationQueryOptions(api));
  if (query.isPending) return <SkeletonLines lines={4} label="Carregando…" />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar a configuração" />;
  if (query.data.sales.discountAuthorityMode !== "force") {
    return (
      <EmptyState
        icon={<ShieldOff size={16} />}
        title="Liberação feita no Sankhya"
        description="Nesta instalação, descontos acima do permitido passam pela liberação no Sankhya depois do envio. Não há aprovação nem limites de desconto no Sales Force."
      />
    );
  }
  return <>{children}</>;
}
