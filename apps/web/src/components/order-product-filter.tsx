import { Button, Checkbox, EmptyState, Popover, PopoverContent, PopoverTrigger, SearchInput, SkeletonLines, titleCase } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Boxes, ChevronDown } from "lucide-react";
import { useState } from "react";
import { productQueryOptions, productsQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { useDebounced } from "../lib/use-debounced";
import { QueryError } from "./query-error";

const RESULT_LIMIT = 8;

/** "Code – Description" of a product for a chip; the code alone while the name loads or if the product is gone. */
export function useProductLabel(code: number): string {
  const api = useApi();
  const product = useQuery({ ...productQueryOptions(api, code), staleTime: 5 * 60_000, retry: false });
  return product.data ? `${code} – ${titleCase(product.data.description)}` : String(code);
}

export interface OrderProductFilterProps {
  /** Product codes selected so far (kept by the URL). */
  codes: readonly number[];
  onChange: (codes: number[]) => void;
  /** How many products can be selected. */
  max: number;
}

/**
 * Multi-select of the products an order must contain. Searches the whole catalog by code, description or
 * reference (an order may hold a product that is no longer sellable, so nothing is pre-filtered); each tick is
 * applied right away and the choice lives in the URL. The active choices are shown as removable chips by the host.
 */
export function OrderProductFilter({ codes, onChange, max }: OrderProductFilterProps) {
  const api = useApi();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim(), 300);
  const query = useQuery(productsQueryOptions(api, { search: debounced || undefined, pageSize: RESULT_LIMIT, sort: "description" }));
  const selected = new Set(codes);
  const full = codes.length >= max;
  const items = query.data?.items ?? [];

  const toggle = (code: number, on: boolean) => onChange(on ? (selected.has(code) ? [...codes] : [...codes, code]) : codes.filter((existing) => existing !== code));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          aria-label="Filtrar por produtos"
          leftIcon={<Boxes size={15} strokeWidth={1.75} aria-hidden="true" />}
          rightIcon={<ChevronDown size={14} aria-hidden="true" />}
          className="w-full justify-between"
        >
          <span className="truncate">
            {codes.length === 0 ? "Todos os produtos" : codes.length === 1 ? "1 produto selecionado" : `${codes.length} produtos selecionados`}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[440px] p-3">
        <div className="flex flex-col gap-2">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Buscar por nome, código ou referência"
            aria-label="Buscar produto para o filtro"
          />
          <div className="flex items-center justify-between text-xs text-fg-muted" aria-live="polite">
            <span>{codes.length === 0 ? "Nenhum produto selecionado" : `${codes.length} de ${max} selecionados`}</span>
            {codes.length > 0 ? (
              <button type="button" className="text-accent hover:underline" onClick={() => onChange([])}>
                Limpar seleção
              </button>
            ) : null}
          </div>
          <div className="max-h-72 overflow-y-auto" aria-busy={query.isFetching}>
            {query.isPending ? (
              <SkeletonLines lines={4} label="Carregando produtos…" />
            ) : query.isError ? (
              <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os produtos" compact />
            ) : items.length === 0 ? (
              <EmptyState compact title="Nenhum produto encontrado" description="Tente outro nome, código ou referência." />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {items.map((product) => (
                  <li key={product.code}>
                    <Checkbox
                      checked={selected.has(product.code)}
                      disabled={full && !selected.has(product.code)}
                      onCheckedChange={(checked) => toggle(product.code, checked === true)}
                      label={titleCase(product.description)}
                      description={`Cód. ${product.code}${product.reference ? ` · Ref. ${product.reference}` : ""}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {query.data && query.data.total > items.length ? (
            <p className="m-0 text-xs text-fg-muted">
              Mostrando {items.length} de {query.data.total.toLocaleString("pt-BR")}. Refine a busca para ver outros.
            </p>
          ) : null}
          {full ? <p className="m-0 text-xs text-fg-muted">Limite de {max} produtos atingido.</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
