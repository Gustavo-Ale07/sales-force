import { Alert, Avatar, Button, Card, CardBody, CardHeader, DateText, EmptyState, KeyValue, KeyValueList, Money, PageHeader, SkeletonLines, StatusBadge, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, formatDocument, toast } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, Plus, RotateCcw } from "lucide-react";
import { useRef } from "react";
import { OrderTemplatesCard } from "../components/order-templates-card";
import { QueryError } from "../components/query-error";
import { TemplateSkippedNotice } from "../components/template-skipped-notice";
import { repeatLastOrder } from "../lib/api-mutations";
import { customerQueryOptions, ordersQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { errorStatus } from "../lib/http-error";
import { orderReference, orderStatusLabels } from "../lib/labels";
import { describeTemplateError, skippedLinesOf } from "../lib/order-templates";
import { CustomerStatus } from "./customers";

const NOT_AVAILABLE = "Não disponível";

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

function CustomerOrders({ customerCode }: { customerCode: number }) {
  const api = useApi();
  const query = useQuery(ordersQueryOptions(api, { customerCode, pageSize: 5, page: 1, sort: "-updatedAt" }));
  return (
    <Card>
      <CardHeader
        title="Pedidos do cliente"
        actions={
          <Link to="/pedidos" search={{ customerCode }} className="text-accent hover:underline">
            Ver todos
          </Link>
        }
      />
      {query.isPending ? (
        <CardBody aria-busy="true">
          <SkeletonLines lines={3} label="Carregando pedidos do cliente…" />
        </CardBody>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os pedidos" compact />
      ) : query.data.items.length === 0 ? (
        <EmptyState compact title="Nenhum pedido para este cliente" description="Crie um novo pedido para começar." />
      ) : (
        <Table label="Pedidos do cliente">
          <TableCaption>Pedidos do cliente</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead numeric>Total estimado</TableHead>
              <TableHead>Atualizado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.items.map((order) => {
              const status = orderStatusLabels[order.status];
              return (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link to="/pedidos/$id" params={{ id: order.id }} className="font-medium text-accent hover:underline">
                      {orderReference(order)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </TableCell>
                  <TableCell numeric>
                    <Money value={order.estimatedTotal} />
                  </TableCell>
                  <TableCell>
                    <DateText value={order.updatedAt} withTime />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
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
        <PageHeader title={`Cliente ${code}`} icon={<Building2 size={16} aria-hidden="true" />} />
        <div aria-busy="true">
          <SkeletonLines lines={6} label="Carregando cliente…" />
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={`Cliente ${code}`} icon={<Building2 size={16} aria-hidden="true" />} />
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar o cliente" />
        </Card>
      </>
    );
  }

  const customer = query.data;
  const resolved = customer.resolvedPriceTable;
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span aria-hidden="true">
              <Avatar name={customer.name} seed={String(customer.code)} size="md" />
            </span>
            {customer.name}
          </span>
        }
        description={customer.tradeName ?? undefined}
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
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cadastro" />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Código">{customer.code}</KeyValue>
              <KeyValue label="CNPJ/CPF">{formatDocument(customer.document)}</KeyValue>
              <KeyValue label="Vendedor">{customer.sellerName ?? "—"}</KeyValue>
              <KeyValue label="Última sincronização">
                <DateText value={customer.syncedAt} withTime />
              </KeyValue>
            </KeyValueList>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Condições comerciais" />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Tabela de preço do cadastro">
                {customer.priceTableCode === null ? "Sem tabela" : `${customer.priceTableCode}${customer.priceTableName ? ` — ${customer.priceTableName}` : ""}`}
              </KeyValue>
              <KeyValue label="Tabela usada nos pedidos">
                {resolved === null ? (
                  <span>Sem tabela resolvida (produtos aparecem como “Sem preço”)</span>
                ) : (
                  `Tabela ${resolved.code} (${resolved.source === "customer" ? "do cliente" : "alternativa da instalação"})`
                )}
              </KeyValue>
              {/* The server sends the credit limit only when the installation and profile allow it. */}
              <KeyValue label="Limite de crédito">
                {customer.creditLimit === null ? <span className="text-fg-faint">{NOT_AVAILABLE}</span> : <Money value={customer.creditLimit} />}
              </KeyValue>
            </KeyValueList>
          </CardBody>
        </Card>
      </div>
      <OrderTemplatesCard customerCode={customer.code} />
      <CustomerOrders customerCode={customer.code} />
    </>
  );
}
