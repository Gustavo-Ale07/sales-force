import type { ApiSchema } from "@salesforce/contracts/client";
import { Button, Card, EmptyState, SkeletonLines, StatusBadge, titleCase, type Tone } from "@salesforce/ui";
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

const STATE_ORDER: Record<Registration["state"], number> = { needs_correction: 0, awaiting_send: 1, draft: 2, sent: 3 };
const VISIBLE = 5;

/** Same mask as the app: only the middle digits show. */
function maskDocument(digits: string): string {
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return `**.***.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  return "*".repeat(Math.max(digits.length, 1));
}

/**
 * Registrations made through Sales Force with the server's state text (`stateLabel`). "Precisa de correção" opens the registration form
 * with the refused data and sends `correctsRegistrationId`. Same labels as the app (PAR-1).
 */
export function CustomerRegistrationsCard() {
  const api = useApi();
  const query = useQuery(customerRegistrationsQueryOptions(api));
  const [correcting, setCorrecting] = useState<Registration | null>(null);
  const [all, setAll] = useState(false);
  const items = [...(query.data?.items ?? [])].sort((x, y) => STATE_ORDER[x.state] - STATE_ORDER[y.state]);
  const shown = all ? items : items.slice(0, VISIBLE);

  return (
    <Card aria-busy={query.isFetching} aria-label="Cadastros de clientes" className="p-3">
      <h2 className="mb-2 text-sm font-semibold text-fg">Cadastros de clientes</h2>
      {query.isPending ? (
        <SkeletonLines lines={2} label="Carregando cadastros..." />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} compact title="Não foi possível carregar os cadastros." />
      ) : items.length === 0 ? (
        <EmptyState compact title="Nenhum cadastro feito pelo Force" />
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {shown.map((item) => (
            <li key={item.registrationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{titleCase(item.name)}</span>
                <span className="block text-xs text-fg-muted">
                  {maskDocument(item.document)}
                  {item.customerCode === null ? "" : ` · Cliente ${item.customerCode}`}
                </span>
                {item.state === "needs_correction" && item.reasonMessage ? <span className="block text-xs text-danger">{item.reasonMessage}</span> : null}
              </span>
              <StatusBadge tone={STATE_TONE[item.state]}>{item.stateLabel}</StatusBadge>
              {item.state === "needs_correction" ? (
                <Button size="sm" variant="secondary" aria-label={`Corrigir cadastro de ${titleCase(item.name)}`} onClick={() => setCorrecting(item)}>
                  Corrigir cadastro
                </Button>
              ) : null}
            </li>
          ))}
          {items.length > VISIBLE ? (
            <li className="py-2">
              <Button size="sm" variant="ghost" onClick={() => setAll((value) => !value)}>
                {all ? "Ver menos" : `Ver todos (${items.length})`}
              </Button>
            </li>
          ) : null}
        </ul>
      )}
      <CustomerCreateDialog open={correcting !== null} onOpenChange={(open) => !open && setCorrecting(null)} correction={correcting} />
    </Card>
  );
}
