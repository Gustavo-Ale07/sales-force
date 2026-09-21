import { Combobox, formatMoney, type ComboboxOption } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { productsQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import type { ListPrice, ProductRow } from "../lib/price-types";
import { useDebounced } from "../lib/use-debounced";
import { NO_PRICE_TEXT } from "./price-cell";

export interface ProductPickerProps {
  /** Customer whose price table resolves the list prices shown in the options. */
  customerCode: number;
  onSelect: (product: ProductRow) => void;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  "aria-label"?: string;
}

function priceText(price: ListPrice): string {
  if (price.state === "none") return NO_PRICE_TEXT;
  const text = formatMoney(price.unitPrice, { minFractionDigits: 2, maxFractionDigits: 6 });
  return price.state === "zero" ? `Preço zero (${text})` : text;
}

/** Search-as-you-type sellable-product selector; never selects a value (each pick is added by the caller). */
export function ProductPicker({ customerCode, onSelect, disabled, ...aria }: ProductPickerProps) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const debounced = useDebounced(query.trim(), 300);
  const { data, isFetching } = useQuery({
    ...productsQueryOptions(api, { search: debounced || undefined, customerCode, sellable: "true", pageSize: 10, page: 1, sort: "description" }),
    enabled: !disabled,
  });
  const items = useMemo(() => data?.items ?? [], [data]);
  const options = useMemo<ComboboxOption[]>(
    () =>
      items.map((product) => ({
        value: String(product.code),
        label: `${product.code} — ${product.description}`,
        description: `${product.unit} · ${priceText(product.listPrice)}`,
      })),
    [items],
  );

  return (
    <Combobox
      key={resetKey}
      {...aria}
      disabled={disabled}
      options={options}
      value={null}
      onValueChange={(value) => {
        const picked = items.find((product) => String(product.code) === value);
        if (!picked) return;
        onSelect(picked);
        setQuery("");
        setResetKey((key) => key + 1);
      }}
      onSearchChange={setQuery}
      loading={isFetching}
      placeholder="Buscar produto por código, descrição ou referência"
      emptyText="Nenhum produto encontrado"
    />
  );
}
