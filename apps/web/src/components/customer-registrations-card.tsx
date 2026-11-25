import type { ApiSchema } from "@salesforce/contracts/client";
import { Button, Card, EmptyState, SkeletonLines, StatusBadge, formatDateTime, formatDocument, titleCase, type Tone } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { customerRegistrationsQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { CustomerCreateDialog } from "./customer-create-dialog";
import { QueryError } from "./query-error";

type Registration = ApiSchema<"CustomerRegistrationView">;

const STATE_TONE: Record<Registration["state"], Tone> = {
  draft: "neutral",
  awaiting_send: "warning",
  sent: "success",
  needs_correction: "danger",
};

/**
 * Registrations made through Sales Force with the server's state text (`stateLabel`). "Precisa de correção" opens the registration form
 * with the refused data and sends `correctsRegistrationId`. Same labels as the app (PAR-1).
 */
export function CustomerRegistrationsCard() {
  const api = useApi();
  const query = useQuery(customerRegistrationsQueryOptions(api));
  const [correcting, setCorrecting] = useState<Registration | null>(null);
  const items = query.data?.items ?? [];

  return (
    <Card aria-busy={query.isFetching} aria-label="Cadastros de clientes" className="p-3">
      <h2 className="mb-2 text-sm font-semibold text-fg">Cadastros de clientes</h2>
      {query.isPending ? (
        <SkeletonLines lines={2} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} compact />
      ) : items.length === 0 ? (
        <EmptyState compact title="Nenhum cadastro feito pelo Force" />
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {items.map((item) => (
            <li key={item.registrationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{titleCase(item.name)}</span>
                <span className="block text-xs text-fg-muted">
                  {formatDocument(item.document)}
                  {item.customerCode === null ? "" : ` · Cliente ${item.customerCode}`}
                  {` · ${formatDateTime(item.createdAt)}`}
                </span>
                {item.state === "needs_correction" && item.reasonMessage ? <span className="block text-xs text-danger">{item.reasonMessage}</span> : null}
              </span>
              <StatusBadge tone={STATE_TONE[item.state]}>{item.stateLabel}</StatusBadge>
              {item.state === "needs_correction" ? (
                <Button size="sm" variant="secondary" aria-label={`Corrigir cadastro de ${titleCase(item.name)}`} onClick={() => setCorrecting(item)}>
                  Corrigir
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <CustomerCreateDialog open={correcting !== null} onOpenChange={(open) => !open && setCorrecting(null)} correction={correcting} />
    </Card>
  );
}
