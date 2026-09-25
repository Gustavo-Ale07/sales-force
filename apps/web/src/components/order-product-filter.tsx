import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  EmptyState,
  Pagination,
  SearchInput,
  SegmentedControl,
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
import { Boxes, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { productGroupsQueryOptions, productQueryOptions, productsQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { useDebounced } from "../lib/use-debounced";
import { QueryError } from "./query-error";

export type ProductMatch = "any" | "all";

export const PRODUCT_MATCH_OPTIONS = [
  { value: "any", label: "Qualquer selecionado", description: "Pedidos que tenham pelo menos um dos produtos selecionados" },
  { value: "all", label: "Todos selecionados", description: "Pedidos que tenham todos os produtos selecionados" },
] as const;

const PAGE_SIZE = 10;

/** "Code – Description" of a product for a chip; the code alone while the name loads or if the product is gone. */
export function useProductLabel(code: number): string {
  const api = useApi();
  const product = useQuery({ ...productQueryOptions(api, code), staleTime: 5 * 60_000, retry: false });
  return product.data ? `${code} – ${titleCase(product.data.description)}` : String(code);
}

export interface OrderProductFilterProps {
  /** Product codes selected so far (kept by the URL). */
  codes: readonly number[];
  /** How several products combine (only meaningful with two or more). */
  match: ProductMatch;
  onChange: (codes: number[], match: ProductMatch) => void;
  /** How many products can be selected. */
  max: number;
}

/**
 * Filter of the products an order must contain, laid out like the multiple entry of a new sale: search by code,
 * description or reference, a group filter, a table with a checkbox per row and pagination. The ticks are kept
 * while paging and searching and only reach the list (and the URL) on "Aplicar filtro". The whole catalog is
 * searched (an order may hold a product that is no longer sellable, so nothing is pre-filtered).
 */
export function OrderProductFilter({ codes, match, onChange, max }: OrderProductFilterProps) {
  const [open, setOpen] = useState(false);
  // The content stays mounted while the dialog fades out, then is dropped so the next opening starts from the URL.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMounted(true);
      }}
    >
      <DialogTrigger asChild>
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
      </DialogTrigger>
      {open || mounted ? (
        <ProductFilterContent
          initial={codes}
          initialMatch={match}
          max={max}
          onApply={(next, nextMatch) => {
            onChange(next, nextMatch);
            setOpen(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function ProductFilterContent({
  initial,
  initialMatch,
  max,
  onApply,
}: {
  initial: readonly number[];
  initialMatch: ProductMatch;
  max: number;
  onApply: (codes: number[], match: ProductMatch) => void;
}) {
  const api = useApi();
  const [picked, setPicked] = useState<number[]>([...initial]);
  const [match, setMatch] = useState<ProductMatch>(initialMatch);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim(), 300);

  const groups = useQuery(productGroupsQueryOptions(api));
  const query = useQuery(
    productsQueryOptions(api, {
      search: debounced || undefined,
      group: group === "" ? undefined : Number(group),
      pageSize: PAGE_SIZE,
      page,
      sort: "description",
    }),
  );
  const items = query.data?.items ?? [];
  const selected = new Set(picked);
  const full = picked.length >= max;
  const pageSelected = items.filter((product) => selected.has(product.code));
  const pageFree = items.filter((product) => !selected.has(product.code));

  const toggle = (code: number, on: boolean) =>
    setPicked((current) => (on ? (current.includes(code) || current.length >= max ? current : [...current, code]) : current.filter((existing) => existing !== code)));
  const togglePage = (on: boolean) =>
    setPicked((current) => {
      if (!on) return current.filter((code) => !items.some((product) => product.code === code));
      const room = Math.max(0, max - current.length);
      return [...current, ...pageFree.slice(0, room).map((product) => product.code)];
    });

  return (
    <DialogContent
      title="Filtrar por produtos"
      description="Escolha os produtos que o pedido deve conter. A seleção vale para todas as páginas e buscas."
      className="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" disabled={picked.length === 0} onClick={() => setPicked([])}>
            Limpar seleção
          </Button>
          <span className="flex-1" />
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => onApply(picked, match)}>
            Aplicar filtro
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <SearchInput
            value={search}
            onValueChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            aria-label="Buscar produto para o filtro"
            placeholder="Buscar por nome, código ou referência"
            wrapperClassName="min-w-[220px] flex-1"
          />
          <Select
            size="md"
            aria-label="Grupo dos produtos do filtro"
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              setPage(1);
            }}
            wrapperClassName="w-[200px]"
          >
            <option value="">Todos os grupos</option>
            {(groups.data?.items ?? []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </Select>
        </div>

        {picked.length > 1 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">Correspondência</span>
            <SegmentedControl<ProductMatch> aria-label="Correspondência dos produtos selecionados" value={match} onValueChange={setMatch} options={PRODUCT_MATCH_OPTIONS} className="sm:max-w-md" />
          </div>
        ) : null}

        <div aria-live="polite" aria-busy={query.isFetching}>
          {query.isPending ? (
            <SkeletonLines lines={4} label="Carregando produtos…" />
          ) : query.isError ? (
            <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os produtos" compact />
          ) : items.length === 0 ? (
            <EmptyState compact title="Nenhum produto encontrado" description="Tente outro nome, código, referência ou grupo." />
          ) : (
            <Table label="Produtos do filtro">
              <TableCaption>Marque os produtos que o pedido deve conter</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Checkbox
                      aria-label="Selecionar todos os produtos desta página"
                      checked={pageSelected.length === 0 ? false : pageFree.length === 0 ? true : "indeterminate"}
                      disabled={pageSelected.length === 0 && (full || pageFree.length === 0)}
                      onCheckedChange={(checked) => togglePage(checked === true)}
                    />
                  </TableHead>
                  <TableHead numeric>Cód.</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Referência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((product) => (
                  <TableRow key={product.code}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Selecionar ${product.description}`}
                        checked={selected.has(product.code)}
                        disabled={full && !selected.has(product.code)}
                        onCheckedChange={(checked) => toggle(product.code, checked === true)}
                      />
                    </TableCell>
                    <TableCell numeric>{product.code}</TableCell>
                    <TableCell wrap>
                      <span className="font-medium">{titleCase(product.description)}</span>
                      {product.groupName ? <span className="block text-fg-muted">{product.groupName}</span> : null}
                    </TableCell>
                    <TableCell>{product.reference ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {query.data && query.data.total > PAGE_SIZE ? (
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={setPage} pageSizeOptions={[PAGE_SIZE]} />
          ) : null}
        </div>
        <p className="m-0 text-xs text-fg-muted" aria-live="polite">
          {picked.length === 0 ? "Nenhum produto selecionado: o filtro não restringe os pedidos." : `${picked.length} de ${max} selecionados.`}
          {full ? ` Limite de ${max} produtos atingido.` : ""}
        </p>
      </div>
    </DialogContent>
  );
}
