import type { ApiSchema } from "@salesforce/contracts/client";
import { Combobox, formatDocument, type ComboboxOption } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { customersQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { useDebounced } from "../lib/use-debounced";

export type PickedCustomer = Pick<ApiSchema<"CustomerListItem">, "code" | "name">;

export interface CustomerPickerProps {
  selected: PickedCustomer | null;
  onSelect: (customer: ApiSchema<"CustomerListItem"> | null) => void;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-labelledby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}

/** Search-as-you-type customer selector over `GET /customers` (scoped by the server). */
export function CustomerPicker({ selected, onSelect, disabled, ...aria }: CustomerPickerProps) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 300);
  const { data, isFetching } = useQuery({
    ...customersQueryOptions(api, { search: debounced || undefined, pageSize: 10, page: 1 }),
    enabled: !disabled,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const options = useMemo<ComboboxOption[]>(() => {
    const list: ComboboxOption[] = items.map((customer) => ({
      value: String(customer.code),
      label: `${customer.code} — ${customer.name}`,
      description: [customer.tradeName, formatDocument(customer.document, ""), customer.active ? "" : "Inativo", customer.blocked ? "Bloqueado" : ""]
        .filter(Boolean)
        .join(" · "),
    }));
    if (selected && !list.some((option) => option.value === String(selected.code))) {
      list.unshift({ value: String(selected.code), label: `${selected.code} — ${selected.name}` });
    }
    return list;
  }, [items, selected]);

  return (
    <Combobox
      {...aria}
      disabled={disabled}
      options={options}
      value={selected ? String(selected.code) : null}
      onValueChange={(value) => {
        if (value === null) return onSelect(null);
        const picked = items.find((customer) => String(customer.code) === value);
        if (picked) onSelect(picked);
      }}
      onSearchChange={setQuery}
      loading={isFetching}
      placeholder="Buscar por código, nome ou documento"
      emptyText="Nenhum cliente encontrado"
    />
  );
}
