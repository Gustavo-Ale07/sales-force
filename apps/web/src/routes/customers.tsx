import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  FilterBar,
  FilterChip,
  FilterField,
  PageHeader,
  Pagination,
  SearchInput,
  StatusDot,
  Select,
  SortableHead,
  StatGrid,
  StatTile,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableLoadingRows,
  TableMessageRow,
  TableRow,
  formatDocument,
  titleCase,
  type SortDirection,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { MetricValueText, METRIC_VISUALS } from "../components/metric-value";
import { QueryError } from "../components/query-error";
import { customersQueryOptions, dashboardQueryOptions, sellersQueryOptions, type CustomersParams } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { CUSTOMER_STATUSES, type CustomersSearch } from "../lib/route-search";
import { asInt, asOneOf, compact } from "../lib/search-params";
import { useSearchBox } from "../lib/use-search-box";

const statusLabels: Record<ApiSchema<"CustomerStatusFilter">, string> = {
  active: "Ativos",
  inactive: "Inativos",
  blocked: "Bloqueados",
};

export interface CustomersPageProps {
  params: CustomersSearch;
  onSearchChange: (next: CustomersSearch) => void;
  onOpenCustomer: (code: number) => void;
}

const COLUMNS = 7;

function sortDirection(sort: CustomersSearch["sort"], field: "name" | "code"): SortDirection | null {
  if (sort === field) return "asc";
  if (sort === `-${field}`) return "desc";
  return null;
}

function toggleSort(sort: CustomersSearch["sort"], field: "name" | "code"): ApiSchema<"CustomerSort"> {
  return sort === field ? (`-${field}` as ApiSchema<"CustomerSort">) : field;
}

export function CustomersPage({ params, onSearchChange, onOpenCustomer }: CustomersPageProps) {
  const api = useApi();
  const apiParams: CustomersParams = { ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 25, sort: params.sort ?? "name" };
  const query = useQuery(customersQueryOptions(api, apiParams));
  const sellers = useQuery(sellersQueryOptions(api));
  const dashboard = useQuery(dashboardQueryOptions(api));
  const portfolio = dashboard.data?.groups.find((group) => group.key === "portfolio");

  const change = (patch: Partial<CustomersSearch>) => onSearchChange(compact({ ...params, page: undefined, ...patch }));
  const [searchText, setSearchText] = useSearchBox(params.search, (search) => change({ search }));

  const sellerOptions = sellers.data?.items ?? [];
  const withSellers = sellerOptions.length > 1;
  const sellerName = sellerOptions.find((s) => s.code === params.sellerCode)?.name;
  const hasFilters =
    params.search !== undefined || params.status !== undefined || params.sellerCode !== undefined || params.hasPriceTable !== undefined;
  const clearAll = () => onSearchChange(compact({ sort: params.sort, pageSize: params.pageSize }));

  return (
    <>
      <PageHeader title="Clientes" count={query.data ? query.data.total.toLocaleString("pt-BR") : undefined} />

      {portfolio && portfolio.metrics.length > 0 ? (
        <section aria-label={portfolio.label}>
          <StatGrid className="sm:grid-cols-4">
              {portfolio.metrics.map((metric) => {
                const visual = METRIC_VISUALS[metric.key];
                return (
                  <StatTile
                    key={metric.key}
                    label={metric.label}
                    value={<MetricValueText metric={metric} />}
                    hint={metric.description ?? undefined}
                    tone={visual?.tone}
                    icon={visual?.icon}
                  />
                );
              })}
          </StatGrid>
        </section>
      ) : null}

      <FilterBar aria-label="Filtros da carteira" grid>
        <FilterField label="Busca" className={withSellers ? "lg:col-span-4" : "sm:col-span-2 lg:col-span-6"}>
          <SearchInput
            size="md"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Código, nome ou documento"
            aria-label="Buscar cliente por código, nome ou documento"
          />
        </FilterField>
        <FilterField label="Situação" className={withSellers ? "lg:col-span-2" : "lg:col-span-3"}>
          <Select size="md" value={params.status ?? ""} onChange={(e) => change({ status: asOneOf(e.target.value, CUSTOMER_STATUSES) })}>
            <option value="">Todas</option>
            {CUSTOMER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </Select>
        </FilterField>
        {withSellers ? (
          <FilterField label="Vendedor" className="lg:col-span-3">
            <Select size="md" value={params.sellerCode ?? ""} onChange={(e) => change({ sellerCode: asInt(e.target.value, 0) })}>
              <option value="">Todos</option>
              {sellerOptions.map((seller) => (
                <option key={seller.code} value={seller.code}>
                  {seller.name}
                </option>
              ))}
            </Select>
          </FilterField>
        ) : null}
        <FilterField label="Tabela de preço" className="lg:col-span-3">
          <Select
            size="md"
            value={params.hasPriceTable ?? ""}
            onChange={(e) => change({ hasPriceTable: asOneOf(e.target.value, ["true", "false"] as const) })}
          >
            <option value="">Todas</option>
            <option value="true">Com tabela</option>
            <option value="false">Sem tabela</option>
          </Select>
        </FilterField>
      </FilterBar>

      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
          {params.search ? <FilterChip onRemove={() => change({ search: undefined })}>{`Busca: ${params.search}`}</FilterChip> : null}
          {params.status ? <FilterChip onRemove={() => change({ status: undefined })}>{statusLabels[params.status]}</FilterChip> : null}
          {params.sellerCode !== undefined ? (
            <FilterChip onRemove={() => change({ sellerCode: undefined })}>{`Vendedor: ${sellerName ?? params.sellerCode}`}</FilterChip>
          ) : null}
          {params.hasPriceTable ? (
            <FilterChip onRemove={() => change({ hasPriceTable: undefined })}>
              {params.hasPriceTable === "true" ? "Com tabela" : "Sem tabela"}
            </FilterChip>
          ) : null}
          <button type="button" onClick={clearAll} className="text-xs text-accent hover:underline">
            Limpar filtros
          </button>
        </div>
      ) : null}

      <Card aria-busy={query.isFetching}>
        <Table label="Clientes">
          <TableCaption>Carteira de clientes</TableCaption>
          <TableHeader>
            <TableRow>
              <SortableHead
                direction={sortDirection(params.sort ?? "name", "code")}
                onSort={() => change({ sort: toggleSort(params.sort, "code") })}
              >
                Código
              </SortableHead>
              <SortableHead
                direction={sortDirection(params.sort ?? "name", "name")}
                onSort={() => change({ sort: toggleSort(params.sort ?? "name", "name") })}
              >
                Cliente
              </SortableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead>Tabela de preço</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              <TableLoadingRows columns={COLUMNS} />
            ) : query.isError ? (
              <TableMessageRow colSpan={COLUMNS}>
                <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} compact />
              </TableMessageRow>
            ) : query.data.items.length === 0 ? (
              <TableMessageRow colSpan={COLUMNS}>
                <EmptyState
                  compact
                  title={hasFilters ? "Nenhum cliente encontrado" : "Nenhum cliente na carteira"}
                  description={
                    hasFilters
                      ? "Ajuste ou limpe os filtros para ver mais resultados."
                      : "Quando houver clientes no seu escopo, eles aparecem aqui."
                  }
                />
              </TableMessageRow>
            ) : (
              query.data.items.map((customer) => (
                <TableRow key={customer.code} interactive className="group" onActivate={() => onOpenCustomer(customer.code)}>
                  <TableCell className="tabular-nums text-fg-muted">{customer.code}</TableCell>
                  <TableCell wrap className="min-w-[12rem]">
                    <span className="flex items-center gap-2">
                      <Avatar name={titleCase(customer.name)} seed={String(customer.code)} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-semibold">{titleCase(customer.name)}</span>
                        {customer.tradeName ? <span className="block text-xs text-fg-muted">{titleCase(customer.tradeName)}</span> : null}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>{formatDocument(customer.document)}</TableCell>
                  <TableCell>
                    <CustomerStatus active={customer.active} blocked={customer.blocked} />
                  </TableCell>
                  <TableCell>{customer.sellerName ?? <span className="text-fg-faint">—</span>}</TableCell>
                  <TableCell>
                    {customer.priceTableCode === null ? (
                      <span className="text-fg-faint">Sem tabela</span>
                    ) : (
                      `Tabela ${customer.priceTableCode}`
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Straight to a new order for this customer; the click must not also open the customer. */}
                    {/* On hover-capable screens the action shows on row hover/focus; touch screens keep it visible. */}
                    <Button
                      asChild
                      size="sm"
                      variant="secondary"
                      className="transition-opacity duration-[var(--sf-dur-fast)] [@media(hover:hover)]:opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Link
                        to="/pedidos/novo"
                        search={{ customer: customer.code }}
                        aria-label={`Novo pedido para ${titleCase(customer.name)}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Plus size={12} aria-hidden="true" />
                        Novo pedido
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {query.data ? (
          <Pagination
            page={query.data.page}
            pageSize={query.data.pageSize}
            total={query.data.total}
            onPageChange={(page) => onSearchChange(compact({ ...params, page: page > 1 ? page : undefined }))}
            onPageSizeChange={(pageSize) => change({ pageSize })}
          />
        ) : null}
      </Card>
    </>
  );
}

export function CustomerStatus({ active, blocked }: { active: boolean; blocked: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      <StatusDot tone={active ? "success" : "neutral"}>{active ? "Ativo" : "Inativo"}</StatusDot>
      {blocked ? <StatusDot tone="danger">Bloqueado</StatusDot> : null}
    </span>
  );
}
