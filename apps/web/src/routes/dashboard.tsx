import type { ApiSchema } from "@salesforce/contracts/client";
import { Badge, Button, Card, DateText, EmptyState, PageHeader, LoadingPanel, StatGrid, StatTile } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, FilePen, Package, Plus, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { findMetric, MetricValueOrUnavailable } from "../components/metric-value";
import { QueryError } from "../components/query-error";
import { dashboardQueryOptions } from "../lib/api-queries";
import { useApi, useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";

type MetricGroup = ApiSchema<"MetricGroup">;
type DashboardResponse = ApiSchema<"DashboardResponse">;

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
      className="block rounded-lg no-underline outline-none transition-[translate,box-shadow] duration-[var(--sf-dur-fast)] ease-spring hover:-translate-y-px hover:shadow-card focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0"
    >
      {children}
    </Link>
  );
}

function DemoBadge({ groups, keys }: { groups: readonly MetricGroup[]; keys: readonly string[] }) {
  const demoLabels = groups.filter((g) => keys.includes(g.key) && g.demo).map((g) => g.label);
  if (demoLabels.length === 0) return null;
  return <Badge tone="warning" title={demoLabels.join(", ")}>Dados de demonstração</Badge>;
}

/** Início, as the app: greeting with the name, then the quick actions and the counters. Recent orders, attention and other indicators are not on the app and are not here. */
export function DashboardPage() {
  const api = useApi();
  const { authClient } = useAppServices();
  const query = useQuery(dashboardQueryOptions(api));
  const session = useQuery(sessionQueryOptions(authClient));

  const groups = query.data?.groups ?? [];
  const customersTotal = findMetric(groups, "portfolio", "customers_total");
  const productsVisible = findMetric(groups, "catalog", "products_visible");
  const productsSellable = findMetric(groups, "catalog", "products_sellable");
  const drafts = findMetric(groups, "orders", "drafts");
  const draftsEstimatedTotal = findMetric(groups, "orders", "drafts_estimated_total");

  return (
    <>
      <PageHeader
        title="Início"
        description={
          <span className="flex flex-col gap-0.5">
            {session.data ? <span>{`Olá, ${session.data.name}`}</span> : null}
            {query.data ? (
              <span className="text-2xs text-fg-faint">
                Escopo: {scopeText(query.data.scope)} · Atualizado em <DateText value={query.data.generatedAt} withTime />{" "}
                <DemoBadge groups={groups} keys={["portfolio", "catalog", "orders", "credit", "positivation"]} />
              </span>
            ) : null}
          </span>
        }
        actions={
          <Button asChild variant="primary" leftIcon={<Plus size={16} strokeWidth={1.75} aria-hidden="true" />}>
            <Link to="/pedidos/novo">Novo pedido</Link>
          </Button>
        }
      />

      {query.isPending ? (
        <LoadingPanel title="Carregando indicadores…" description="Reunindo clientes, produtos e pedidos da sua carteira." lines={6} />
      ) : query.isError ? (
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
        </Card>
      ) : query.data.groups.length === 0 ? (
        <Card>
          <EmptyState title="Sem indicadores ainda" description="Quando houver dados na sua carteira e pedidos, o resumo aparece aqui." />
        </Card>
      ) : (
        <StatGrid variant="tiles" className="sm:grid-cols-3">
          <KpiLink to="/clientes">
            <StatTile label="Clientes" icon={<Users size={16} aria-hidden="true" />} tone="accent" value={<MetricValueOrUnavailable metric={customersTotal} />} />
          </KpiLink>
          <KpiLink to="/produtos">
            <StatTile label="Produtos" icon={<Package size={16} aria-hidden="true" />} tone="info" value={<MetricValueOrUnavailable metric={productsVisible} />} />
          </KpiLink>
          <KpiLink to="/produtos" search={{ sellable: "true" }}>
            <StatTile label="Vendáveis" icon={<BadgeCheck size={16} aria-hidden="true" />} tone="success" value={<MetricValueOrUnavailable metric={productsSellable} />} />
          </KpiLink>
          <KpiLink to="/pedidos" search={{ status: "draft" }}>
            <StatTile label="Pedidos em aberto" icon={<FilePen size={16} aria-hidden="true" />} tone="warning" value={<MetricValueOrUnavailable metric={drafts} />} />
          </KpiLink>
          <KpiLink to="/pedidos" search={{ status: "draft" }}>
            <StatTile label="R$ não enviados" icon={<Wallet size={16} aria-hidden="true" />} tone="neutral" value={<MetricValueOrUnavailable metric={draftsEstimatedTotal} />} />
          </KpiLink>
        </StatGrid>
      )}
    </>
  );
}
