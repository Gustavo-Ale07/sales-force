import { Alert, Avatar, Button, Card, PageHeader, SkeletonLines, toast, titleCase } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, RotateCcw } from "lucide-react";
import { useRef } from "react";
import { CustomerFichaTabs } from "../components/customer-ficha";
import { OrderTemplatesCard } from "../components/order-templates-card";
import { QueryError } from "../components/query-error";
import { TemplateSkippedNotice } from "../components/template-skipped-notice";
import { repeatLastOrder } from "../lib/api-mutations";
import { customerQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { errorStatus } from "../lib/http-error";
import { describeTemplateError, skippedLinesOf } from "../lib/order-templates";
import { CustomerStatus } from "./customers";

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * "Repetir último pedido": creates a new, independent draft from the customer's most recent NON-cancelled order
 * recorded in Sales Force (never Sankhya/ERP history — no such mirror exists). Only product + quantity are copied;
 * prices are always recomputed server-side. Reachable in one click from the customer page (RF, Fase C). The
 * mutation is lifted out of the button itself so its failure can be shown as a page-level notice below the header,
 * not squeezed into the header's right-aligned actions row.
 */
function useRepeatLastOrder(customerCode: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Kept while the previous attempt ended in an unknown outcome (network error, 5xx, 429), so a retry after a
  // lost response cannot create a second draft; dropped on success and on every definitive answer (404, 409).
  const requestId = useRef<string | null>(null);
  return useMutation({
    mutationFn: () => {
      if (!requestId.current) requestId.current = newUuid();
      return repeatLastOrder(api, customerCode, { clientRequestId: requestId.current });
    },
    onError: (error) => {
      const status = errorStatus(error);
      const unknownOutcome = status === undefined || status === 0 || status >= 500 || status === 429;
      if (!unknownOutcome) requestId.current = null;
      // The customer is gone from the caller's scope: the page on screen is stale.
      if (status === 404) void queryClient.invalidateQueries({ queryKey: queryKeys.customer(customerCode) });
    },
    onSuccess: async (result) => {
      requestId.current = null;
      queryClient.setQueryData(queryKeys.order(result.order.id), result.order);
      // Refreshing other screens must not delay opening the new draft.
      void queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      if (result.skippedLines.length === 0) {
        toast({ title: "Rascunho criado a partir do último pedido registrado no Sales Force", tone: "success" });
      }
      await navigate({
        to: "/pedidos/$id",
        params: { id: result.order.id },
        state: { orderNotice: { source: "repeat-last", skippedLines: result.skippedLines } },
      });
    },
  });
}

type RepeatLastOrderMutation = ReturnType<typeof useRepeatLastOrder>;

function RepeatLastOrderButton({ mutation }: { mutation: RepeatLastOrderMutation }) {
  return (
    <Button
      variant="secondary"
      leftIcon={<RotateCcw size={14} aria-hidden="true" />}
      loading={mutation.isPending}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      Repetir último pedido
    </Button>
  );
}

/** Page-level notice for a failed "Repetir último pedido": an informational alert when there is no previous order, a danger alert with the skipped-lines list otherwise. */
function RepeatLastOrderNotice({ mutation }: { mutation: RepeatLastOrderMutation }) {
  if (!mutation.isError) return null;
  const failure = describeTemplateError(mutation.error, "Não foi possível repetir o último pedido", "use", "repeat-last");
  return (
    <>
      <Alert tone={failure.reason === "no_previous_order" ? "info" : "danger"} title={failure.title} onDismiss={() => mutation.reset()}>
        {failure.description}
        {failure.correlationId ? (
          <span className="mt-1 block text-xs">
            Código de correlação: <span className="font-mono">{failure.correlationId}</span>
          </span>
        ) : null}
      </Alert>
      {failure.reason === "no_usable_lines" ? <TemplateSkippedNotice lines={skippedLinesOf(mutation.error)} /> : null}
    </>
  );
}

export function CustomerDetailPage({ code }: { code: number }) {
  const api = useApi();
  const query = useQuery(customerQueryOptions(api, code));
  // Declared unconditionally (before the loading/error early returns) so the hook order never changes; the
  // button and its notice are only rendered once the customer has loaded.
  const repeatLast = useRepeatLastOrder(code);

  if (query.isPending) {
    return (
      <>
        <PageHeader title={`Cliente ${code}`} />
        <div aria-busy="true">
          <SkeletonLines lines={6} label="Carregando cliente…" />
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={`Cliente ${code}`} />
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar o cliente" />
        </Card>
      </>
    );
  }

  const customer = query.data;
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span aria-hidden="true">
              <Avatar name={titleCase(customer.name)} seed={String(customer.code)} size="md" />
            </span>
            {titleCase(customer.name)}
          </span>
        }
        description={customer.tradeName ? titleCase(customer.tradeName) : undefined}
        badges={<CustomerStatus active={customer.active} blocked={customer.blocked} />}
        actions={
          <>
            <Button asChild variant="primary" leftIcon={<Plus size={14} aria-hidden="true" />}>
              <Link to="/pedidos/novo" search={{ customer: customer.code }}>
                Novo pedido
              </Link>
            </Button>
            <RepeatLastOrderButton mutation={repeatLast} />
          </>
        }
      />
      <RepeatLastOrderNotice mutation={repeatLast} />
      <CustomerFichaTabs customerCode={customer.code} />
      <OrderTemplatesCard customerCode={customer.code} />
    </>
  );
}
