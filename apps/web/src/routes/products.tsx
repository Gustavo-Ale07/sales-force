import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Badge,
  Card,
  Drawer,
  DrawerContent,
  EmptyState,
  FilterBar,
  FilterChip,
  FilterField,
  KeyValue,
  KeyValueList,
  PageHeader,
  Pagination,
  SearchInput,
  StatusDot,
  Select,
  SkeletonLines,
  SortableHead,
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
import { CustomerPicker } from "../components/customer-picker";
import { PriceCell } from "../components/price-cell";
import { ProductImage } from "../components/product-image";
import { QueryError } from "../components/query-error";
import {
  customerQueryOptions,
  productGroupsQueryOptions,
  productQueryOptions,
  productsQueryOptions,
  type ProductsParams,
} from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { priceContextSourceLabels } from "../lib/labels";
import { BOOLEAN_TEXT, PRICE_STATES, type ProductsSearch } from "../lib/route-search";
import { asInt, asOneOf, compact } from "../lib/search-params";
import { useSearchBox } from "../lib/use-search-box";


const priceStateLabels: Record<ApiSchema<"ListPriceState">, string> = {
  priced: "Com preço",
  zero: "Preço zero",
  none: "Sem preço",
};

function sortDirection(sort: ProductsSearch["sort"], field: "description" | "code"): SortDirection | null {
  if (sort === field) return "asc";
  if (sort === `-${field}`) return "desc";
  return null;
}

function toggleSort(sort: ProductsSearch["sort"], field: "description" | "code"): ApiSchema<"ProductSort"> {
  return sort === field ? (`-${field}` as ApiSchema<"ProductSort">) : field;
}

function ProductDetailPanel({ code, customerCode }: { code: number; customerCode?: number }) {
  const api = useApi();
  const query = useQuery(productQueryOptions(api, code, customerCode));
  if (query.isPending) {
    return (
      <div aria-busy="true">
        <SkeletonLines lines={6} label="Carregando produto…" />
      </div>
    );
  }
  if (query.isError) {
    return <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar o produto" compact />;
  }
  const product = query.data;
  const context = product.priceContext;
  return (
    <div className="flex flex-col gap-3">
      <ProductImage image={product.image} description={product.description} name={titleCase(product.description)} variant="full" className="self-center" />
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={product.active ? "success" : "neutral"}>{product.active ? "Ativo" : "Inativo"}</Badge>
        <Badge tone={product.sellable ? "info" : "neutral"}>{product.sellable ? "Disponível para venda" : "Não vendável"}</Badge>
      </div>
      <KeyValueList>
        <KeyValue label="Código">{product.code}</KeyValue>
        <KeyValue label="Unidade">{product.unit}</KeyValue>
        <KeyValue label="Marca">{product.brand ?? "—"}</KeyValue>
        <KeyValue label="Referência">{product.reference ?? "—"}</KeyValue>
        <KeyValue label="Grupo">{product.groupName ?? "—"}</KeyValue>
        <KeyValue label="Uso">{product.usageCode ?? "—"}</KeyValue>
        <KeyValue label="Preço de lista">
          <PriceCell price={product.listPrice} />
        </KeyValue>
        <KeyValue label="Origem do preço">
          {context.tableCode === null
            ? priceContextSourceLabels[context.source]
            : `Tabela ${context.tableCode}${context.tableName ? ` — ${context.tableName}` : ""} (${priceContextSourceLabels[context.source]})`}
        </KeyValue>
      </KeyValueList>
    </div>
  );
}

export interface ProductsPageProps {
  params: ProductsSearch;
  onSearchChange: (next: ProductsSearch) => void;
}

const COLUMNS = 6;

export function ProductsPage({ params, onSearchChange }: ProductsPageProps) {
  const api = useApi();
  const { product: openProduct, ...filters } = params;
  const apiParams: ProductsParams = { ...filters, page: params.page ?? 1, pageSize: params.pageSize ?? 25, sort: params.sort ?? "description" };
  const query = useQuery(productsQueryOptions(api, apiParams));
  const groups = useQuery(productGroupsQueryOptions(api));
  const pricingCustomer = useQuery({
    ...customerQueryOptions(api, params.customerCode ?? 0),
    enabled: params.customerCode !== undefined,
  });

  const change = (patch: Partial<ProductsSearch>) => onSearchChange(compact({ ...params, page: undefined, ...patch }));
  const [searchText, setSearchText] = useSearchBox(params.search, (search) => change({ search }));

  const groupName = groups.data?.items.find((g) => g.code === params.group)?.name;
  const hasFilters =
    params.search !== undefined ||
    params.group !== undefined ||
    params.sellable !== undefined ||
    params.priceState !== undefined ||
    params.customerCode !== undefined;
  const clearAll = () => onSearchChange(compact({ sort: params.sort, pageSize: params.pageSize }));
  const context = query.data?.priceContext;

  return (
    <>
      <PageHeader title="Catálogo de produtos" count={query.data ? query.data.total.toLocaleString("pt-BR") : undefined} />

      <FilterBar aria-label="Filtros do catálogo" grid>
        <FilterField label="Busca" className="lg:col-span-6">
          <SearchInput
            size="md"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Código, descrição ou referência"
            aria-label="Buscar produto por código, descrição ou referência"
          />
        </FilterField>
        <div className="flex min-w-0 flex-col gap-1 lg:col-span-6">
          <span id="products-customer-label" className="text-xs font-medium text-fg-muted">
            Preços para o cliente
          </span>
          <CustomerPicker
            aria-labelledby="products-customer-label"
            selected={
              params.customerCode === undefined
                ? null
                : { code: params.customerCode, name: pricingCustomer.data?.name ?? `Cliente ${params.customerCode}` }
            }
            onSelect={(customer) => change({ customerCode: customer?.code })}
          />
        </div>
        <FilterField label="Grupo" className="lg:col-span-4">
          <Select size="md" value={params.group ?? ""} onChange={(e) => change({ group: asInt(e.target.value, 0) })}>
            <option value="">Todos</option>
            {groups.data?.items.map((group) => (
              <option key={group.code} value={group.code}>
                {group.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Venda" className="lg:col-span-4">
          <Select size="md" value={params.sellable ?? ""} onChange={(e) => change({ sellable: asOneOf(e.target.value, BOOLEAN_TEXT) })}>
            <option value="">Todos</option>
            <option value="true">Vendáveis</option>
            <option value="false">Não vendáveis</option>
          </Select>
        </FilterField>
        <FilterField label="Preço" className="sm:col-span-2 lg:col-span-4">
          <Select size="md" value={params.priceState ?? ""} onChange={(e) => change({ priceState: asOneOf(e.target.value, PRICE_STATES) })}>
            <option value="">Todos</option>
            {PRICE_STATES.map((state) => (
              <option key={state} value={state}>
                {priceStateLabels[state]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
          {params.search ? <FilterChip onRemove={() => change({ search: undefined })}>{`Busca: ${params.search}`}</FilterChip> : null}
          {params.group !== undefined ? <FilterChip onRemove={() => change({ group: undefined })}>{`Grupo: ${groupName ?? params.group}`}</FilterChip> : null}
          {params.sellable ? (
            <FilterChip onRemove={() => change({ sellable: undefined })}>{params.sellable === "true" ? "Vendáveis" : "Não vendáveis"}</FilterChip>
          ) : null}
          {params.priceState ? <FilterChip onRemove={() => change({ priceState: undefined })}>{priceStateLabels[params.priceState]}</FilterChip> : null}
          {params.customerCode !== undefined ? (
            <FilterChip onRemove={() => change({ customerCode: undefined })}>{`Cliente: ${pricingCustomer.data?.name ?? params.customerCode}`}</FilterChip>
          ) : null}
          <button type="button" onClick={clearAll} className="text-xs text-accent hover:underline">
            Limpar filtros
          </button>
        </div>
      ) : null}

      {context ? (
        <Alert tone={context.source === "none" ? "warning" : "info"} title="Origem dos preços">
          {context.source === "none"
            ? "Nenhuma tabela de preço se aplica a esta consulta; os produtos aparecem como “Sem preço”."
            : `Preços da tabela ${context.tableCode ?? ""}${context.tableName ? ` — ${context.tableName}` : ""} (${priceContextSourceLabels[context.source]}).`}
        </Alert>
      ) : null}

      <Card aria-busy={query.isFetching}>
        <Table label="Produtos">
          <TableCaption>Catálogo de produtos</TableCaption>
          <TableHeader>
            <TableRow>
              <SortableHead direction={sortDirection(params.sort, "code")} onSort={() => change({ sort: toggleSort(params.sort, "code") })}>
                Código
              </SortableHead>
              <SortableHead
                direction={sortDirection(params.sort ?? "description", "description")}
                onSort={() => change({ sort: toggleSort(params.sort ?? "description", "description") })}
              >
                Descrição
              </SortableHead>
              <TableHead>Grupo</TableHead>
              <TableHead>Un.</TableHead>
              <TableHead>Venda</TableHead>
              <TableHead numeric>Preço de lista</TableHead>
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
                  title={hasFilters ? "Nenhum produto encontrado" : "Catálogo vazio"}
                  description={hasFilters ? "Ajuste ou limpe os filtros para ver mais resultados." : "Os produtos aparecem aqui após a sincronização com o ERP."}
                />
              </TableMessageRow>
            ) : (
              query.data.items.map((product) => (
                <TableRow key={product.code} interactive onActivate={() => onSearchChange(compact({ ...params, product: product.code }))}>
                  <TableCell className="tabular-nums text-fg-muted">{product.code}</TableCell>
                  <TableCell wrap className="min-w-[12rem]">
                    <span className="flex items-center gap-2">
                      <ProductImage image={product.image} description={product.description} name={titleCase(product.description)} />
                      <span className="min-w-0">
                        <span className="font-medium">{titleCase(product.description)}</span>
                        {product.reference ? <span className="block text-fg-muted">Ref. {product.reference}</span> : null}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>{product.groupName ?? "—"}</TableCell>
                  <TableCell>{product.unit}</TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
                      <StatusDot tone={product.sellable ? "success" : "neutral"}>{product.sellable ? "Vendável" : "Não vendável"}</StatusDot>
                      {product.active ? null : <StatusDot tone="neutral">Inativo</StatusDot>}
                    </span>
                  </TableCell>
                  <TableCell numeric>
                    <PriceCell price={product.listPrice} />
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

      <Drawer open={openProduct !== undefined} onOpenChange={(open) => !open && onSearchChange(compact({ ...params, product: undefined }))}>
        <DrawerContent title={`Produto ${openProduct ?? ""}`.trim()} description="Detalhes do produto e origem do preço">
          <div className="p-4">
            {openProduct !== undefined ? <ProductDetailPanel code={openProduct} customerCode={params.customerCode} /> : null}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
