import {
  Badge,
  Button,
  EmptyState,
  FieldError,
  Input,
  Pagination,
  SearchInput,
  Select,
  SkeletonLines,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  titleCase,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { productGroupsQueryOptions, productsQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { parseQuantityInput, quantityProblemMessages } from "../lib/order-draft";
import type { ProductRow } from "../lib/price-types";
import { useDebounced } from "../lib/use-debounced";
import { PriceCell } from "./price-cell";
import { QueryError } from "./query-error";

const PAGE_SIZE = 20;

/** Search, group and page of the table; kept by the host so they survive switching to the cart and back. */
export interface ProductFilters {
  search: string;
  group: string;
  page: number;
}

export const INITIAL_PRODUCT_FILTERS: ProductFilters = { search: "", group: "", page: 1 };

export interface ProductBrowserProps {
  filters: ProductFilters;
  onFiltersChange: (filters: ProductFilters) => void;
  /** Customer whose price table resolves the list prices; `null` until the order has one. */
  customerCode: number | null;
  /** Quantity text of the products already in the cart, by product code. */
  cartQuantities: ReadonlyMap<number, string>;
  /** Adds the product with an already validated quantity text (comma decimal separator). */
  onAdd: (product: ProductRow, quantityText: string) => void;
  /** Id of the search field, so the editor can move the focus back to it. */
  searchId: string;
}

/**
 * "Produtos" view of a new sale (Vidya parity): a searchable, group-filterable table of sellable products with a
 * quantity field per row. Filters that need data the installation does not have (promotion, purchase history, best
 * sellers, stock-outs) are deliberately absent, see VIDYA_GAPS.
 */
export function ProductBrowser({ filters, onFiltersChange, customerCode, cartQuantities, onAdd, searchId }: ProductBrowserProps) {
  const api = useApi();
  const { search, group, page } = filters;
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [problems, setProblems] = useState<Record<number, string>>({});
  const debounced = useDebounced(search.trim(), 300);

  const groups = useQuery(productGroupsQueryOptions(api));
  const query = useQuery({
    ...productsQueryOptions(api, {
      search: debounced || undefined,
      group: group === "" ? undefined : Number(group),
      customerCode: customerCode ?? 0,
      sellable: "true",
      pageSize: PAGE_SIZE,
      page,
      sort: "description",
    }),
    enabled: customerCode !== null,
  });

  if (customerCode === null) {
    return <EmptyState compact title="Selecione o cliente" description="Os preços dos produtos dependem da tabela de preço do cliente." />;
  }

  const add = (product: ProductRow) => {
    const text = (quantities[product.code] ?? "").trim();
    const parsed = parseQuantityInput(text === "" ? "1" : text);
    if (!parsed.ok) {
      setProblems((current) => ({ ...current, [product.code]: quantityProblemMessages[parsed.problem] }));
      return;
    }
    setProblems(({ [product.code]: _dropped, ...rest }) => rest);
    setQuantities(({ [product.code]: _dropped, ...rest }) => rest);
    onAdd(product, text === "" ? "1" : text);
  };

  const items = query.data?.items ?? [];
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b border-line px-3 py-2">
        <SearchInput
          id={searchId}
          value={search}
          onValueChange={(value) => onFiltersChange({ ...filters, search: value, page: 1 })}
          aria-label="Buscar produto"
          placeholder="Buscar por código, descrição ou referência"
          wrapperClassName="min-w-[240px] flex-1"
        />
        <Select
          size="md"
          aria-label="Grupo"
          value={group}
          onChange={(event) => onFiltersChange({ ...filters, group: event.target.value, page: 1 })}
          wrapperClassName="w-full sm:w-[220px]"
        >
          <option value="">Todos os grupos</option>
          {(groups.data?.items ?? []).map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </Select>
      </div>
      <div aria-live="polite" aria-busy={query.isFetching}>
        {query.isPending ? (
          <div className="p-3">
            <SkeletonLines lines={4} label="Carregando produtos…" />
          </div>
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os produtos" compact />
        ) : items.length === 0 ? (
          <EmptyState compact title="Nenhum produto encontrado" description="Ajuste a busca ou o grupo." />
        ) : (
          <Table label="Produtos">
            <TableCaption>Produtos disponíveis para venda</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead numeric>Cód.</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Un.</TableHead>
                <TableHead numeric>Valor tabela</TableHead>
                <TableHead>Quantidade</TableHead>
                <TableHead>
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((product) => {
                const inCart = cartQuantities.get(product.code);
                const problem = problems[product.code];
                const errorId = `product-qty-error-${product.code}`;
                return (
                  <TableRow key={product.code}>
                    <TableCell numeric>{product.code}</TableCell>
                    <TableCell wrap>
                      <span className="font-medium">{titleCase(product.description)}</span>
                      {product.groupName ? <span className="block text-fg-muted">{product.groupName}</span> : null}
                    </TableCell>
                    <TableCell>{product.unit}</TableCell>
                    <TableCell numeric>
                      <PriceCell price={product.listPrice} />
                    </TableCell>
                    <TableCell>
                      {inCart !== undefined ? (
                        <Badge tone="success">No carrinho: {inCart}</Badge>
                      ) : (
                        <>
                          <Input
                            size="sm"
                            inputMode="decimal"
                            autoComplete="off"
                            className="w-[90px]"
                            placeholder="1"
                            value={quantities[product.code] ?? ""}
                            aria-label={`Quantidade de ${product.description} a adicionar`}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={problem ? errorId : undefined}
                            onChange={(event) => {
                              const value = event.target.value;
                              setQuantities((current) => ({ ...current, [product.code]: value }));
                              setProblems(({ [product.code]: _dropped, ...rest }) => rest);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                              event.preventDefault();
                              add(product);
                            }}
                          />
                          {problem ? <FieldError id={errorId}>{problem}</FieldError> : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      {inCart !== undefined ? null : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          leftIcon={<Plus size={13} aria-hidden="true" />}
                          aria-label={`Adicionar ${product.description}`}
                          onClick={() => add(product)}
                        >
                          Adicionar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {query.data && query.data.total > PAGE_SIZE ? (
          <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={(next) => onFiltersChange({ ...filters, page: next })} pageSizeOptions={[PAGE_SIZE]} />
        ) : null}
      </div>
    </div>
  );
}
