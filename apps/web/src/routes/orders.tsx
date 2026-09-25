import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Button,
  Card,
  DateText,
  EmptyState,
  FilterBar,
  FilterChip,
  FilterField,
  Input,
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
import { OrderProductFilter, useProductLabel } from "../components/order-product-filter";
import { QueryError } from "../components/query-error";
import { customerQueryOptions, ordersQueryOptions, type OrdersParams } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { formatCount, orderReference, orderStatusLabels } from "../lib/labels";
import { MAX_ORDER_PRODUCTS, ORDER_DATE_FIELDS, ORDER_PRODUCT_MATCHES, ORDER_STATUSES, type OrdersSearch } from "../lib/route-search";
import { asDate, asOneOf, compact } from "../lib/search-params";
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

/** The URL only carries the customer code; the name is read for display (the code alone until it loads). */
function useCustomerName(code: number | undefined): string | undefined {
  const api = useApi();
  const customer = useQuery({ ...customerQueryOptions(api, code ?? 0), enabled: code !== undefined, staleTime: 30_000, retry: false });
  return customer.data?.name;
}

/** Customer filter: the same selector modal as the new sale. */
function CustomerFilter({ code, onChange }: { code: number | undefined; onChange: (code: number | undefined) => void }) {
  const name = useCustomerName(code);
  return (
    <CustomerPicker
      aria-label="Filtrar por cliente"
      selected={code === undefined ? null : { code, name: name ?? "" }}
      onSelect={(picked) => onChange(picked?.code)}
    />
  );
}

/** Date input that commits to the URL only complete, valid dates (or an emptied field), so typing never fires half-dates. */
function DateFilterInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  min?: string | undefined;
  max?: string | undefined;
  onCommit: (value: string | undefined) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  // The URL moved (chip removed, link opened, start pushed by the end): show it. Adjusting during render avoids an effect.
  if (seen !== value) {
    setSeen(value);
    setText(value ?? "");
  }
  return (
    <Input
      type="date"
      value={text}
      min={min}
      max={max}
      aria-label={label}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next === "") onCommit(undefined);
        else if (asDate(next) !== undefined) onCommit(next);
      }}
    />
  );
}

const dateFieldLabels = { createdAt: "Criação", updatedAt: "Última atualização" } as const;
const dateFieldPast = { createdAt: "Criado", updatedAt: "Atualizado" } as const;

/** `2026-03-31` → `31/03/2026` without going through a time zone. */
function formatIsoDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function periodLabel(params: OrdersSearch): string {
  const prefix = dateFieldPast[params.dateField ?? "createdAt"];
  if (params.from && params.to) return `${prefix} de ${formatIsoDate(params.from)} a ${formatIsoDate(params.to)}`;
  if (params.from) return `${prefix} a partir de ${formatIsoDate(params.from)}`;
  return `${prefix} até ${formatIsoDate(params.to ?? "")}`;
}

/** A glance at what the order holds: the first product names and how many more, on one muted line. */
function ItemPreview({ names, total }: { names: readonly string[]; total: number }) {
  if (names.length === 0) return null;
  const more = total - names.length;
  const text = `${names.map(titleCase).join(" · ")}${more > 0 ? ` · +${more}` : ""}`;
  return (
    <span className="mt-0.5 block max-w-[28rem] truncate text-xs font-normal text-fg-muted" title={text}>
      {text}
    </span>
  );
}

function CustomerChip({ code, onRemove }: { code: number; onRemove: () => void }) {
  const name = useCustomerName(code);
  return <FilterChip onRemove={onRemove}>{name ? `Cliente: ${titleCase(name)}` : `Cliente ${code}`}</FilterChip>;
}

function ProductChip({ code, onRemove }: { code: number; onRemove: () => void }) {
  const label = useProductLabel(code);
  return <FilterChip onRemove={onRemove}>{`Produto: ${label}`}</FilterChip>;
}

export function OrdersPage({ params, onSearchChange, onOpenOrder }: OrdersPageProps) {
  const api = useApi();
  const { products, ...rest } = params;
  const apiParams: OrdersParams = {
    ...rest,
    ...(products ? { productCodes: products.join(",") } : {}),
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
    sort: params.sort ?? "-updatedAt",
  };
  const query = useQuery(ordersQueryOptions(api, apiParams));
  const [discarding, setDiscarding] = useState<{ id: string; label: string } | null>(null);

  const change = (patch: Partial<OrdersSearch>) => onSearchChange(compact({ ...params, page: undefined, ...patch }));
  const [searchText, setSearchText] = useSearchBox(params.search, (search) => change({ search }));
  const selectedProducts = params.products ?? [];
  const hasPeriod = params.from !== undefined || params.to !== undefined;
  const hasFilters =
    params.search !== undefined || params.status !== undefined || params.customerCode !== undefined || hasPeriod || selectedProducts.length > 0;
  const clearAll = () => onSearchChange(compact({ sort: params.sort, pageSize: params.pageSize }));
  const currentSort = params.sort ?? "-updatedAt";
  const setFrom = (from: string | undefined) => change({ from, to: from !== undefined && params.to !== undefined && params.to < from ? from : params.to });
  const setTo = (to: string | undefined) => change({ to, from: to !== undefined && params.from !== undefined && params.from > to ? to : params.from });

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

      <FilterBar aria-label="Filtros de pedidos" className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-12">
        <FilterField label="Nº do pedido ou cliente" className="lg:col-span-4">
          <SearchInput
            size="md"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Número ou cliente"
            aria-label="Buscar pedido por número ou cliente"
          />
        </FilterField>
        <FilterField label="Cliente" className="lg:col-span-5">
          <CustomerFilter code={params.customerCode} onChange={(customerCode) => change({ customerCode })} />
        </FilterField>
        <FilterField label="Situação" className="lg:col-span-3">
          <Select size="md" value={params.status ?? ""} onChange={(e) => change({ status: asOneOf(e.target.value, ORDER_STATUSES) })}>
            <option value="">Todas</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabels[status].label}
              </option>
            ))}
          </Select>
        </FilterField>

        <FilterField label="Período por" className="lg:col-span-2">
          <Select
            size="md"
            aria-label="Data usada no período"
            value={params.dateField ?? "createdAt"}
            onChange={(e) => change({ dateField: asOneOf(e.target.value, ORDER_DATE_FIELDS) })}
          >
            {ORDER_DATE_FIELDS.map((field) => (
              <option key={field} value={field}>
                {dateFieldLabels[field]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="De" className="lg:col-span-2">
          <DateFilterInput label="Data inicial" value={params.from} max={params.to} onCommit={setFrom} />
        </FilterField>
        <FilterField label="Até" className="lg:col-span-2">
          <DateFilterInput label="Data final" value={params.to} min={params.from} onCommit={setTo} />
        </FilterField>
        <FilterField label="Produtos" className="lg:col-span-4 sm:col-span-2">
          <OrderProductFilter codes={selectedProducts} max={MAX_ORDER_PRODUCTS} onChange={(codes) => change({ products: codes.length > 0 ? codes : undefined, productMatch: codes.length > 1 ? params.productMatch : undefined })} />
        </FilterField>
        {selectedProducts.length > 1 ? (
          <FilterField label="Pedidos com" className="lg:col-span-2">
            <Select
              size="md"
              aria-label="Combinação dos produtos"
              value={params.productMatch ?? "any"}
              onChange={(e) => change({ productMatch: asOneOf(e.target.value, ORDER_PRODUCT_MATCHES) })}
            >
              <option value="any">Qualquer produto</option>
              <option value="all">Todos os produtos</option>
            </Select>
          </FilterField>
        ) : null}
      </FilterBar>

      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
          {params.search ? <FilterChip onRemove={() => change({ search: undefined })}>{`Busca: ${params.search}`}</FilterChip> : null}
          {params.status ? <FilterChip onRemove={() => change({ status: undefined })}>{orderStatusLabels[params.status].label}</FilterChip> : null}
          {params.customerCode !== undefined ? <CustomerChip code={params.customerCode} onRemove={() => change({ customerCode: undefined })} /> : null}
          {hasPeriod ? (
            <FilterChip onRemove={() => change({ from: undefined, to: undefined, dateField: undefined })}>{periodLabel(params)}</FilterChip>
          ) : null}
          {selectedProducts.length > 1 ? (
            <span className="text-xs text-fg-muted">{params.productMatch === "all" ? "Contendo todos:" : "Contendo qualquer um:"}</span>
          ) : null}
          {selectedProducts.map((code) => (
            <ProductChip
              key={code}
              code={code}
              onRemove={() => {
                const rest = selectedProducts.filter((existing) => existing !== code);
                change({ products: rest.length > 0 ? rest : undefined, productMatch: rest.length > 1 ? params.productMatch : undefined });
              }}
            />
          ))}
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
                    hasFilters ? (
                      <Button size="sm" variant="secondary" onClick={clearAll}>
                        Limpar filtros
                      </Button>
                    ) : (
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
                    <TableCell wrap className="min-w-[10rem]">
                      {titleCase(order.customerName)}
                      <ItemPreview names={order.itemPreview} total={order.itemCount} />
                    </TableCell>
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
