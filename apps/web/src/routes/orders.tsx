import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Button,
  Card,
  DateText,
  EmptyState,
  FilterBar,
  FilterChip,
  FilterField,
  Money,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SortableHead,
  StatusDot,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableLoadingRows,
  TableMessageRow,
  TableRow,
  type SortDirection,
  titleCase,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { CustomerPicker } from "../components/customer-picker";
import { DiscardOrderDialog } from "../components/discard-order-dialog";
import { QueryError } from "../components/query-error";
import { customerQueryOptions, ordersQueryOptions, type OrdersParams } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { formatCount, orderReference, orderStatusLabels } from "../lib/labels";
import { ORDER_STATUSES, type OrdersSearch } from "../lib/route-search";
import { asOneOf, compact } from "../lib/search-params";
import { useSearchBox } from "../lib/use-search-box";


function sortDirection(sort: OrdersSearch["sort"], field: "updatedAt" | "draftNumber"): SortDirection | null {
  if (sort === field) return "asc";
  if (sort === `-${field}`) return "desc";
  return null;
}

function toggleSort(sort: OrdersSearch["sort"], field: "updatedAt" | "draftNumber"): ApiSchema<"OrderSort"> {
  return sort === field ? (`-${field}` as ApiSchema<"OrderSort">) : field;
}

export interface OrdersPageProps {
  params: OrdersSearch;
  onSearchChange: (next: OrdersSearch) => void;
  onOpenOrder: (id: string) => void;
}

const COLUMNS = 8;

/** Customer filter: the same selector modal as the new sale; the URL only carries the code, the name is read for display. */
function CustomerFilter({ code, onChange }: { code: number | undefined; onChange: (code: number | undefined) => void }) {
  const api = useApi();
  const customer = useQuery({ ...customerQueryOptions(api, code ?? 0), enabled: code !== undefined, staleTime: 30_000 });
  return (
    <CustomerPicker
      aria-label="Filtrar por cliente"
      selected={code === undefined ? null : { code, name: customer.data?.name ?? "" }}
      onSelect={(picked) => onChange(picked?.code)}
    />
  );
}

export function OrdersPage({ params, onSearchChange, onOpenOrder }: OrdersPageProps) {
  const api = useApi();
  const apiParams: OrdersParams = { ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 25, sort: params.sort ?? "-updatedAt" };
  const query = useQuery(ordersQueryOptions(api, apiParams));
  const [discarding, setDiscarding] = useState<{ id: string; label: string } | null>(null);

  const change = (patch: Partial<OrdersSearch>) => onSearchChange(compact({ ...params, page: undefined, ...patch }));
  const [searchText, setSearchText] = useSearchBox(params.search, (search) => change({ search }));
  const hasFilters = params.search !== undefined || params.status !== undefined || params.customerCode !== undefined;
  const clearAll = () => onSearchChange(compact({ sort: params.sort, pageSize: params.pageSize }));
  const currentSort = params.sort ?? "-updatedAt";

  return (
    <>
      <PageHeader
        title="Vendas"
        count={query.data ? query.data.total.toLocaleString("pt-BR") : undefined}
        description="Pedidos e rascunhos. O envio ao ERP ainda não está habilitado nesta instalação."
        actions={
          <Button asChild variant="primary" leftIcon={<Plus size={16} strokeWidth={1.75} aria-hidden="true" />}>
            <Link to="/pedidos/novo">Novo pedido</Link>
          </Button>
        }
      />

      <FilterBar aria-label="Filtros de pedidos">
        <FilterField label="Nº do pedido ou cliente" className="min-w-[220px] flex-1">
          <SearchInput
            size="md"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Número ou cliente"
            aria-label="Buscar pedido por número ou cliente"
          />
        </FilterField>
        <FilterField label="Cliente" className="min-w-[240px] flex-1">
          <CustomerFilter code={params.customerCode} onChange={(customerCode) => change({ customerCode })} />
        </FilterField>
        <FilterField label="Situação" className="w-[180px]">
          <Select size="md" value={params.status ?? ""} onChange={(e) => change({ status: asOneOf(e.target.value, ORDER_STATUSES) })}>
            <option value="">Todas</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabels[status].label}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
          {params.search ? <FilterChip onRemove={() => change({ search: undefined })}>{`Busca: ${params.search}`}</FilterChip> : null}
          {params.status ? <FilterChip onRemove={() => change({ status: undefined })}>{orderStatusLabels[params.status].label}</FilterChip> : null}
          {params.customerCode !== undefined ? (
            <FilterChip onRemove={() => change({ customerCode: undefined })}>{`Cliente ${params.customerCode}`}</FilterChip>
          ) : null}
          <button type="button" onClick={clearAll} className="text-xs text-accent hover:underline">
            Limpar filtros
          </button>
        </div>
      ) : null}

      <Card aria-busy={query.isFetching}>
        <Table label="Pedidos">
          <TableCaption>Pedidos e rascunhos</TableCaption>
          <TableHeader>
            <TableRow>
              <SortableHead
                direction={sortDirection(currentSort, "draftNumber")}
                onSort={() => change({ sort: toggleSort(currentSort, "draftNumber") })}
              >
                Pedido
              </SortableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead numeric>Itens</TableHead>
              <TableHead numeric>Total estimado</TableHead>
              <SortableHead
                direction={sortDirection(currentSort, "updatedAt")}
                onSort={() => change({ sort: toggleSort(currentSort, "updatedAt") })}
              >
                Atualizado em
              </SortableHead>
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
                  title={hasFilters ? "Nenhum pedido encontrado" : "Nenhum pedido ainda"}
                  description={hasFilters ? "Ajuste ou limpe os filtros para ver mais resultados." : "Crie um novo pedido; ele fica salvo como rascunho."}
                  action={
                    hasFilters ? undefined : (
                      <Button asChild size="sm" variant="primary">
                        <Link to="/pedidos/novo">Novo pedido</Link>
                      </Button>
                    )
                  }
                />
              </TableMessageRow>
            ) : (
              query.data.items.map((order) => {
                const status = orderStatusLabels[order.status];
                return (
                  <TableRow key={order.id} interactive onActivate={() => onOpenOrder(order.id)}>
                    <TableCell>
                      <span className="font-medium">{orderReference(order)}</span>
                    </TableCell>
                    <TableCell wrap className="min-w-[10rem]">{titleCase(order.customerName)}</TableCell>
                    <TableCell>
                      <DateText value={order.createdAt} />
                    </TableCell>
                    <TableCell>
                      <StatusDot tone={status.tone}>{status.label}</StatusDot>
                    </TableCell>
                    <TableCell numeric>{formatCount(order.itemCount)}</TableCell>
                    <TableCell numeric>
                      <Money value={order.estimatedTotal} />
                      {order.isPartial ? <span className="ml-1 text-fg-muted">(parcial)</span> : null}
                    </TableCell>
                    <TableCell>
                      <DateText value={order.updatedAt} withTime />
                    </TableCell>
                    <TableCell>
                      {order.status === "draft" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Descartar ${orderReference(order)}`}
                          leftIcon={<Trash2 size={13} aria-hidden="true" />}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDiscarding({ id: order.id, label: orderReference(order) });
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          Descartar
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
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

      <DiscardOrderDialog order={discarding} onClose={() => setDiscarding(null)} />
    </>
  );
}
