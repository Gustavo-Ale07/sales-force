import {
  Badge,
  Checkbox,
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
import { useState } from "react";
import { productGroupsQueryOptions, productsQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { parseQuantityInput, quantityProblemMessages } from "../lib/order-draft";
import type { ProductRow } from "../lib/price-types";
import { useDebounced } from "../lib/use-debounced";
import { PriceCell } from "./price-cell";
import { QueryError } from "./query-error";

const PAGE_SIZE = 10;

export interface PickedProduct {
  product: ProductRow;
  /** As typed (pt-BR); empty means 1. */
  quantityText: string;
}

/** Products ticked so far, by code; kept by the host so the choice survives filters, pages and tab changes. */
export type ProductSelection = ReadonlyMap<number, PickedProduct>;

export interface ProductMultiSelectProps {
  customerCode: number;
  selection: ProductSelection;
  onSelectionChange: (selection: ProductSelection) => void;
  /** Products already in the order: shown, not selectable. */
  existingCodes: ReadonlySet<number>;
  isPriceOrderable: (state: "priced" | "zero" | "none") => boolean;
  /** How many more lines the order can take. */
  remainingSlots: number;
}

export function quantityProblem(quantityText: string): string | null {
  const text = quantityText.trim();
  if (text === "") return null;
  const parsed = parseQuantityInput(text);
  return parsed.ok ? null : quantityProblemMessages[parsed.problem];
}

/**
 * "Selecionar produtos" tab of the multiple entry (Vidya parity): the sellable products of the customer's price
 * table with a checkbox and a quantity per row, so many can be picked at once and added together.
 */
export function ProductMultiSelect({
  customerCode,
  selection,
  onSelectionChange,
  existingCodes,
  isPriceOrderable,
  remainingSlots,
}: ProductMultiSelectProps) {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim(), 300);

  const groups = useQuery(productGroupsQueryOptions(api));
  const query = useQuery(
    productsQueryOptions(api, {
      search: debounced || undefined,
      group: group === "" ? undefined : Number(group),
      customerCode,
      sellable: "true",
      pageSize: PAGE_SIZE,
      page,
      sort: "description",
    }),
  );

  const items = query.data?.items ?? [];
  const selectable = (product: ProductRow) => !existingCodes.has(product.code) && isPriceOrderable(product.listPrice.state);
  const pageSelectable = items.filter(selectable);
  const pageSelected = pageSelectable.filter((product) => selection.has(product.code));
  const full = selection.size >= remainingSlots;

  const update = (mutate: (next: Map<number, PickedProduct>) => void) => {
    const next = new Map(selection);
    mutate(next);
    onSelectionChange(next);
  };
  const toggle = (product: ProductRow, on: boolean) =>
    update((next) => {
      if (on) next.set(product.code, { product, quantityText: next.get(product.code)?.quantityText ?? "" });
      else next.delete(product.code);
    });
  const togglePage = (on: boolean) =>
    update((next) => {
      for (const product of pageSelectable) {
        if (!on) next.delete(product.code);
        else if (!next.has(product.code) && next.size < remainingSlots) next.set(product.code, { product, quantityText: "" });
      }
    });
  const setQuantity = (product: ProductRow, quantityText: string) =>
    update((next) => {
      // Typing a quantity is choosing the product.
      if (!next.has(product.code) && next.size >= remainingSlots) return;
      next.set(product.code, { product, quantityText });
    });

  const allChecked = pageSelectable.length > 0 && pageSelected.length === pageSelectable.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <SearchInput
          value={search}
          onValueChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          aria-label="Buscar produto para seleção"
          placeholder="Código, descrição ou referência"
          wrapperClassName="min-w-[220px] flex-1"
        />
        <Select
          size="md"
          aria-label="Grupo dos produtos a selecionar"
          value={group}
          onChange={(event) => {
            setGroup(event.target.value);
            setPage(1);
          }}
          wrapperClassName="w-full sm:w-[200px]"
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
          <SkeletonLines lines={4} label="Carregando produtos…" />
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os produtos" compact />
        ) : items.length === 0 ? (
          <EmptyState compact title="Nenhum produto encontrado" description="Ajuste a busca ou o grupo." />
        ) : (
          <Table label="Produtos a selecionar">
            <TableCaption>Selecione os produtos e informe as quantidades</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox
                    aria-label="Selecionar todos os produtos desta página"
                    checked={pageSelected.length === 0 ? false : allChecked ? true : "indeterminate"}
                    disabled={pageSelectable.length === 0 || (full && pageSelected.length === 0)}
                    onCheckedChange={(checked) => togglePage(checked === true)}
                  />
                </TableHead>
                <TableHead numeric>Cód.</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Un.</TableHead>
                <TableHead numeric>Valor tabela</TableHead>
                <TableHead>Quantidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((product) => {
                const picked = selection.get(product.code);
                const inOrder = existingCodes.has(product.code);
                const blocked = !inOrder && !isPriceOrderable(product.listPrice.state);
                const problem = picked ? quantityProblem(picked.quantityText) : null;
                const errorId = `multi-qty-error-${product.code}`;
                return (
                  <TableRow key={product.code}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Selecionar ${product.description}`}
                        checked={picked !== undefined}
                        disabled={inOrder || blocked || (full && picked === undefined)}
                        onCheckedChange={(checked) => toggle(product, checked === true)}
                      />
                    </TableCell>
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
                      {inOrder ? (
                        <Badge tone="success">No carrinho</Badge>
                      ) : blocked ? (
                        <Badge tone="warning">Sem preço</Badge>
                      ) : (
                        <>
                          <Input
                            size="sm"
                            inputMode="decimal"
                            autoComplete="off"
                            className="w-[90px]"
                            placeholder="1"
                            value={picked?.quantityText ?? ""}
                            disabled={full && picked === undefined}
                            aria-label={`Quantidade de ${product.description}`}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={problem ? errorId : undefined}
                            onChange={(event) => setQuantity(product, event.target.value)}
                          />
                          {problem ? <FieldError id={errorId}>{problem}</FieldError> : null}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {query.data && query.data.total > PAGE_SIZE ? (
          <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={setPage} pageSizeOptions={[PAGE_SIZE]} />
        ) : null}
      </div>
      {full ? <p className="m-0 text-xs text-fg-muted">Limite de itens do pedido atingido.</p> : null}
    </div>
  );
}
