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
  SimpleBarChart,
  SkeletonLines,
  StatGrid,
  StatTile,
  StatusDot,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  type BarChartDatum,
  titleCase,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Ban, CheckCircle2, ChevronRight, Plus, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { findMetric, metricCount, MetricValueOrUnavailable, MetricValueText } from "../components/metric-value";
import { QueryError } from "../components/query-error";
import { dashboardQueryOptions } from "../lib/api-queries";
import { useApi, useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import { orderReference, orderStatusLabels } from "../lib/labels";

type Metric = ApiSchema<"Metric">;
type MetricGroup = ApiSchema<"MetricGroup">;
type DashboardResponse = ApiSchema<"DashboardResponse">;
type OrderListItem = ApiSchema<"OrderListItem">;

function greeting(hour = new Date().getHours()): string {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** Status distribution of the recent orders already listed below — not the whole order history, just this list read as a chart. */
function recentOrdersDistribution(orders: readonly OrderListItem[]): BarChartDatum[] {
  const counts = new Map<OrderListItem["status"], number>();
  for (const order of orders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, value]) => ({ key: status, label: orderStatusLabels[status].label, value, tone: orderStatusLabels[status].tone }));
}

function scopeText(scope: DashboardResponse["scope"]): string {
  if (scope.kind === "all") return "Todos os vendedores";
  return scope.sellerCodes.length === 1 ? `Vendedor ${scope.sellerCodes[0]}` : `Vendedores ${scope.sellerCodes.join(", ")}`;
}

/** One clickable KPI tile: the whole card is the link, focus-visible ring stands in for hover on keyboard nav. */
function KpiLink({ to, search, children }: { to: string; search?: Record<string, unknown>; children: ReactNode }) {
  return (
    <Link
      to={to as never}
      search={search as never}
      className="-m-2 block rounded-lg p-2 outline-none transition-colors duration-[var(--sf-dur-fast)] hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

interface AttentionItemDef {
  key: string;
  count: number | null;
  icon: ReactNode;
  title: (count: number) => string;
  to: string;
  search: Record<string, unknown>;
}

/** One secondary indicator as a quiet row: label (and hint) left, value right; an unavailable value stays small. */
function OtherIndicatorRow({ metric }: { metric: Metric }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <p className="m-0 text-sm font-medium text-fg">{metric.label}</p>
      <p className="m-0 text-sm font-semibold tabular-nums text-fg">
        <MetricValueText metric={metric} />
      </p>
      {metric.description ? <p className="m-0 w-full text-xs text-fg-muted">{metric.description}</p> : null}
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItemDef }) {
  if (item.count === null || item.count <= 0) return null;
  return (
    <Link
      to={item.to as never}
      search={item.search as never}
      className="flex items-center gap-3 rounded-md px-2.5 py-2.5 no-underline transition-colors duration-150 ease-spring hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-warn-bg text-warn">{item.icon}</span>
      <span className="min-w-0 flex-1 text-sm font-medium text-fg">{item.title(item.count)}</span>
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-fg-faint" />
    </Link>
  );
}

function RecentOrders({ orders }: { orders: DashboardResponse["recentOrders"] }) {
  const distribution = recentOrdersDistribution(orders);
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
        <>
          <CardBody className="border-b border-line">
            <p className="m-0 mb-2 text-xs font-medium text-fg-muted">Situação dos pedidos recentes</p>
            <SimpleBarChart data={distribution} />
          </CardBody>
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
                    <TableCell>{titleCase(order.customerName)}</TableCell>
                    <TableCell>
                      <StatusDot tone={status.tone}>{status.label}</StatusDot>
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
        </>
      )}
    </Card>
  );
}

function DemoBadge({ groups, keys }: { groups: readonly MetricGroup[]; keys: readonly string[] }) {
  const demoLabels = groups.filter((g) => keys.includes(g.key) && g.demo).map((g) => g.label);
  if (demoLabels.length === 0) return null;
  return <Badge tone="warning" title={demoLabels.join(", ")}>Dados de demonstração</Badge>;
}

export function DashboardPage() {
  const api = useApi();
  const { authClient } = useAppServices();
  const query = useQuery(dashboardQueryOptions(api));
  const session = useQuery(sessionQueryOptions(authClient));
  const firstName = session.data?.name.split(" ")[0];

  const groups = query.data?.groups ?? [];
  const customersTotal = findMetric(groups, "portfolio", "customers_total");
  const customersActive = findMetric(groups, "portfolio", "customers_active");
  const customersBlocked = findMetric(groups, "portfolio", "customers_blocked");
  const customersWithoutPriceTable = findMetric(groups, "portfolio", "customers_without_price_table");
  const productsVisible = findMetric(groups, "catalog", "products_visible");
  const productsSellable = findMetric(groups, "catalog", "products_sellable");
  const productsSellableWithoutPrice = findMetric(groups, "catalog", "products_sellable_without_price");
  const drafts = findMetric(groups, "orders", "drafts");
  const draftsEstimatedTotal = findMetric(groups, "orders", "drafts_estimated_total");
  const cancelled = findMetric(groups, "orders", "cancelled");
  const creditIndicators = findMetric(groups, "credit", "credit_indicators");
  const positivationRate = findMetric(groups, "positivation", "positivation_rate");

  const attentionItems: AttentionItemDef[] = [
    {
      key: "customers_blocked",
      count: metricCount(customersBlocked),
      icon: <Ban size={15} aria-hidden="true" />,
      title: (n) => `${n === 1 ? "1 cliente bloqueado" : `${n} clientes bloqueados`}`,
      to: "/clientes",
      search: { status: "blocked" },
    },
    {
      key: "customers_without_price_table",
      count: metricCount(customersWithoutPriceTable),
      icon: <Tag size={15} aria-hidden="true" />,
      title: (n) => `${n === 1 ? "1 cliente sem tabela de preço" : `${n} clientes sem tabela de preço`}`,
      to: "/clientes",
      search: { hasPriceTable: "false" },
    },
    {
      key: "products_sellable_without_price",
      count: metricCount(productsSellableWithoutPrice),
      icon: <AlertTriangle size={15} aria-hidden="true" />,
      title: (n) => `${n === 1 ? "1 produto vendável sem preço" : `${n} produtos vendáveis sem preço`}`,
      to: "/produtos",
      search: { sellable: "true", priceState: "none" },
    },
  ];
  const pendingAttention = attentionItems.filter((item) => item.count !== null && item.count > 0);

  return (
    <>
      <PageHeader
        title="Início"
        description={
          <span className="flex flex-col gap-0.5">
            <span>{firstName ? `${greeting()}, ${firstName}.` : "Resumo da sua carteira e dos pedidos recentes."}</span>
            {query.data ? (
              <span className="text-2xs text-fg-faint">
                Escopo: {scopeText(query.data.scope)} · Atualizado em <DateText value={query.data.generatedAt} withTime />{" "}
                <DemoBadge groups={groups} keys={["portfolio", "catalog", "orders", "credit", "positivation"]} />
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button asChild variant="primary" leftIcon={<Plus size={16} strokeWidth={1.75} aria-hidden="true" />}>
              <Link to="/pedidos/novo">Novo pedido</Link>
            </Button>
          </>
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
          <StatGrid className="sm:grid-cols-3">
            <KpiLink to="/clientes">
              <StatTile label="Clientes" value={<MetricValueOrUnavailable metric={customersTotal} />} />
            </KpiLink>
            <KpiLink to="/clientes" search={{ status: "active" }}>
              <StatTile label="Ativos" value={<MetricValueOrUnavailable metric={customersActive} />} />
            </KpiLink>
            <KpiLink to="/produtos">
              <StatTile label="Produtos" value={<MetricValueOrUnavailable metric={productsVisible} />} />
            </KpiLink>
            <KpiLink to="/produtos" search={{ sellable: "true" }}>
              <StatTile label="Vendáveis" value={<MetricValueOrUnavailable metric={productsSellable} />} />
            </KpiLink>
            <KpiLink to="/pedidos" search={{ status: "draft" }}>
              <StatTile label="Pedidos em aberto" value={<MetricValueOrUnavailable metric={drafts} />} />
            </KpiLink>
            <KpiLink to="/pedidos" search={{ status: "draft" }}>
              <StatTile label="R$ em rascunhos" value={<MetricValueOrUnavailable metric={draftsEstimatedTotal} />} />
            </KpiLink>
          </StatGrid>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-2" aria-label="Atenção necessária">
              <CardHeader
                title="Atenção necessária"
                actions={pendingAttention.length > 0 ? <Badge tone="warning">{pendingAttention.length}</Badge> : undefined}
              />
              <CardBody className={cn(pendingAttention.length > 0 && "p-1.5")}>
                {pendingAttention.length === 0 ? (
                  <div className="flex items-center gap-2.5 px-1.5 py-1.5 text-sm text-fg-muted">
                    <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 text-ok" />
                    Nenhuma pendência no momento.
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {pendingAttention.map((item) => (
                      <AttentionRow key={item.key} item={item} />
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card aria-label="Outros indicadores">
              <CardHeader title="Outros indicadores" />
              <CardBody>
                {[cancelled, creditIndicators, positivationRate].map((metric) =>
                  metric ? <OtherIndicatorRow key={metric.key} metric={metric} /> : null,
                )}
              </CardBody>
            </Card>
          </div>

          <RecentOrders orders={query.data.recentOrders} />
        </>
      )}
    </>
  );
}
