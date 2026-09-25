import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Avatar,
  Dialog,
  DialogContent,
  DialogTrigger,
  SearchInput,
  SkeletonLines,
  StatusBadge,
  cn,
  formatDocument,
  titleCase,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, X } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { customersQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { useDebounced } from "../lib/use-debounced";

export type PickedCustomer = Pick<ApiSchema<"CustomerListItem">, "code" | "name">;

const RESULT_LIMIT = 20;

function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd className="m-0 truncate text-sm text-fg">{children}</dd>
    </div>
  );
}

/** One result: code + legal name as the title, avatar with initials, label/value pairs (Vidya "seletor de cliente"). */
function CustomerCard({ customer, onPick }: { customer: ApiSchema<"CustomerListItem">; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-left transition-[border-color,box-shadow] duration-150 ease-spring hover:border-accent hover:shadow-sm focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-center gap-3">
        <Avatar name={customer.name} seed={String(customer.code)} size="lg" className="rounded-full" aria-hidden="true" role="presentation" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
          {customer.code} – {titleCase(customer.name)}
        </span>
        {!customer.active ? <StatusBadge tone="neutral">Inativo</StatusBadge> : null}
        {customer.blocked ? <StatusBadge tone="danger">Bloqueado</StatusBadge> : null}
      </span>
      <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <CardField label="Razão social">{titleCase(customer.name)}</CardField>
        <CardField label="CPF / CNPJ">{formatDocument(customer.document, "—")}</CardField>
        <CardField label="Nome fantasia">{customer.tradeName ? titleCase(customer.tradeName) : "—"}</CardField>
        <CardField label="Vendedor">{customer.sellerName ?? "—"}</CardField>
      </dl>
    </button>
  );
}

function CustomerSearchResults({
  onPick,
  inputRef,
}: {
  onPick: (customer: ApiSchema<"CustomerListItem">) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 300);
  const { data, isPending, isError, isFetching } = useQuery(
    customersQueryOptions(api, { search: debounced || undefined, pageSize: RESULT_LIMIT, page: 1 }),
  );
  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        aria-label="Cliente"
        placeholder="Código, nome ou documento"
        size="lg"
      />
      <div aria-live="polite" aria-busy={isFetching} className="flex flex-col gap-2">
        {isPending ? (
          <SkeletonLines lines={3} label="Carregando clientes…" />
        ) : isError ? (
          <p role="alert" className="m-0 py-6 text-center text-sm text-danger">
            Não foi possível carregar os clientes. Tente novamente.
          </p>
        ) : items.length === 0 ? (
          <p className="m-0 flex items-center justify-center gap-2 py-6 text-sm text-fg-muted">
            <Search size={15} aria-hidden="true" />
            Nenhum cliente encontrado
          </p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {items.map((customer) => (
                <li key={customer.code}>
                  <CustomerCard customer={customer} onPick={() => onPick(customer)} />
                </li>
              ))}
            </ul>
            {data && data.total > items.length ? (
              <p className="m-0 text-center text-xs text-fg-muted">
                Mostrando {items.length} de {data.total} clientes. Refine a busca para ver os demais.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export interface CustomerPickerProps {
  selected: PickedCustomer | null;
  onSelect: (customer: ApiSchema<"CustomerListItem"> | null) => void;
  disabled?: boolean;
  /** Same height as the small inputs of a filter bar (default matches the form fields). */
  compact?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-labelledby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}

/**
 * Customer selector, Vidya style: a field that opens a dedicated modal with a search box and result cards
 * over `GET /customers` (scoped by the server), never a text dropdown. The selected customer can be removed
 * with the "×" beside the field.
 */
export function CustomerPicker({ selected, onSelect, disabled, compact, ...aria }: CustomerPickerProps) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative flex w-full items-center">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            {...aria}
            disabled={disabled}
            aria-haspopup="dialog"
            className={cn(
              compact ? "h-8" : "h-10",
              "flex w-full min-w-0 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-left text-sm text-fg transition-colors duration-[var(--sf-dur-fast)]",
              "hover:border-accent focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted",
              "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger",
              selected ? "pr-8" : "",
            )}
          >
            <span className={cn("min-w-0 flex-1 truncate", selected ? "" : "text-fg-faint")}>
              {selected ? `${selected.code} — ${titleCase(selected.name)}` : "Selecionar cliente"}
            </span>
            {selected ? null : <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-fg-faint" />}
          </button>
        </DialogTrigger>
        <DialogContent
          title="Selecionar cliente"
          className="max-w-2xl"
          onOpenAutoFocus={(event) => {
            // The first focusable in the dialog is the close button; the search box is what the seller needs.
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <CustomerSearchResults
            inputRef={searchRef}
            onPick={(customer) => {
              setOpen(false);
              onSelect(customer);
            }}
          />
        </DialogContent>
      </Dialog>
      {selected && !disabled ? (
        <button
          type="button"
          aria-label="Remover cliente"
          onClick={() => onSelect(null)}
          className="absolute right-1 flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
