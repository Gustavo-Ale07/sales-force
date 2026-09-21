import { Button, Card, CardBody, CardHeader, DateText, EmptyState, KeyValue, KeyValueList, Money, PageHeader, SkeletonLines, StatusBadge, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, formatDocument } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { QueryError } from "../components/query-error";
import { customerQueryOptions, ordersQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { orderReference, orderStatusLabels } from "../lib/labels";
import { CustomerStatus } from "./customers";

const NOT_AVAILABLE = "Não disponível";

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
  const resolved = customer.resolvedPriceTable;
  return (
    <>
      <PageHeader
        title={customer.name}
        description={customer.tradeName ?? undefined}
        badges={<CustomerStatus active={customer.active} blocked={customer.blocked} />}
        actions={
          <Button asChild variant="primary" leftIcon={<Plus size={14} aria-hidden="true" />}>
            <Link to="/pedidos/novo" search={{ customer: customer.code }}>
              Novo pedido
            </Link>
          </Button>
        }
      />
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
      <CustomerOrders customerCode={customer.code} />
    </>
  );
}
