import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DateText,
  EmptyState,
  Money,
  PageHeader,
  SkeletonLines,
  StatGrid,
  StatTile,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatPercent,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { QueryError } from "../components/query-error";
import { dashboardQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { formatCount, orderReference, orderStatusLabels } from "../lib/labels";

type Metric = ApiSchema<"Metric">;
type MetricGroup = ApiSchema<"MetricGroup">;
type DashboardResponse = ApiSchema<"DashboardResponse">;

export const METRIC_UNAVAILABLE = "Não disponível";

function MetricValueText({ metric }: { metric: Metric }) {
  const value = metric.value;
  if (value === null) return <span className="text-fg-faint">{METRIC_UNAVAILABLE}</span>;
  switch (value.kind) {
    case "count":
      return <>{formatCount(value.value)}</>;
    case "money":
      return <Money value={value.value} />;
    case "percent":
      return <>{formatPercent(value.value)}</>;
  }
}

function scopeText(scope: DashboardResponse["scope"]): string {
  if (scope.kind === "all") return "Todos os vendedores";
  return scope.sellerCodes.length === 1
    ? `Vendedor ${scope.sellerCodes[0]}`
    : `Vendedores ${scope.sellerCodes.join(", ")}`;
}

function MetricGroupCard({ group }: { group: MetricGroup }) {
  return (
    <Card aria-label={group.label}>
      <CardHeader
        title={group.label}
        actions={group.demo ? <Badge tone="warning">Dados de demonstração</Badge> : undefined}
      />
      <CardBody>
        {group.metrics.length === 0 ? (
          <p className="m-0 text-xs text-fg-muted">Sem indicadores neste grupo.</p>
        ) : (
          <StatGrid>
            {group.metrics.map((metric) => (
              <StatTile key={metric.key} label={metric.label} value={<MetricValueText metric={metric} />} hint={metric.description ?? undefined} />
            ))}
          </StatGrid>
        )}
      </CardBody>
    </Card>
  );
}

function RecentOrders({ orders }: { orders: DashboardResponse["recentOrders"] }) {
  return (
    <Card>
      <CardHeader
        title="Pedidos recentes"
        actions={
          <Link to="/pedidos" className="text-accent hover:underline">
            Ver todos
          </Link>
        }
      />
      {orders.length === 0 ? (
        <EmptyState compact title="Nenhum pedido recente" description="Os rascunhos e pedidos que você criar aparecem aqui." />
      ) : (
        <Table label="Pedidos recentes">
          <TableCaption>Pedidos recentes</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead numeric>Total estimado</TableHead>
              <TableHead>Atualizado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => {
              const status = orderStatusLabels[order.status];
              return (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link to="/pedidos/$id" params={{ id: order.id }} className="font-medium text-accent hover:underline">
                      {orderReference(order)}
                    </Link>
                  </TableCell>
                  <TableCell>{order.customerName}</TableCell>
                  <TableCell>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </TableCell>
                  <TableCell numeric>
                    <Money value={order.estimatedTotal} />
                    {order.isPartial ? <span className="ml-1 text-fg-muted">(parcial)</span> : null}
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

export function DashboardPage() {
  const api = useApi();
  const query = useQuery(dashboardQueryOptions(api));

  return (
    <>
      <PageHeader
        title="Início"
        description={
          query.data ? (
            <>
              Escopo: {scopeText(query.data.scope)} · Atualizado em <DateText value={query.data.generatedAt} withTime />
            </>
          ) : (
            "Resumo da sua carteira e dos pedidos recentes."
          )
        }
        actions={
          <Button asChild variant="primary" leftIcon={<Plus size={14} aria-hidden="true" />}>
            <Link to="/pedidos/novo">Novo pedido</Link>
          </Button>
        }
      />

      {query.isPending ? (
        <div aria-busy="true">
          <SkeletonLines lines={6} label="Carregando indicadores…" />
        </div>
      ) : query.isError ? (
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
        </Card>
      ) : query.data.groups.length === 0 && query.data.recentOrders.length === 0 ? (
        <Card>
          <EmptyState title="Sem indicadores ainda" description="Quando houver dados na sua carteira e pedidos, o resumo aparece aqui." />
        </Card>
      ) : (
        <>
          {query.data.groups.map((group) => (
            <MetricGroupCard key={group.key} group={group} />
          ))}
          <RecentOrders orders={query.data.recentOrders} />
        </>
      )}
    </>
  );
}
