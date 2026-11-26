import { Combobox, type ComboboxProps } from "@salesforce/ui";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { normalizeName } from "../lib/customer-form";

export interface PickableCity {
  code: number;
  name: string;
  uf: string;
}

export interface CityPickerProps
  extends Omit<ComboboxProps, "options" | "value" | "onValueChange" | "onSearchChange" | "emptyText" | "wrapperClassName" | "placeholder"> {
  cities: readonly PickableCity[];
  /** Selected ERP city code, or null. */
  value: number | null;
  onChange: (code: number | null) => void;
}

const MAX_OPTIONS = 60;

export const cityLabel = (city: PickableCity) => `${city.name} - ${city.uf}`;

/** City chooser: search box with magnifier (accent/case-insensitive), shown as "Nome - UF". Same base component as the seller chooser. */
export function CityPicker({ cities, value, onChange, className, ...props }: CityPickerProps) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const needle = normalizeName(query);
    const matches = cities
      .filter((city) => normalizeName(cityLabel(city)).includes(needle))
      .sort((a, b) => cityLabel(a).localeCompare(cityLabel(b), "pt-BR", { sensitivity: "base" }))
      .slice(0, MAX_OPTIONS);
    const selected = value === null ? undefined : cities.find((city) => city.code === value);
    if (selected && !matches.includes(selected)) matches.unshift(selected);
    return matches.map((city) => ({ value: String(city.code), label: cityLabel(city) }));
  }, [cities, query, value]);
  return (
    <div className="relative w-full min-w-0">
      <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-fg-muted" />
      <Combobox
        {...props}
        onBlur={(event) => {
          props.onBlur?.(event);
          setQuery("");
        }}
        className={className ? `pl-7 ${className}` : "pl-7"}
        options={options}
        value={value === null ? null : String(value)}
        onValueChange={(next) => {
          setQuery("");
          onChange(next === null ? null : Number(next));
        }}
        onSearchChange={setQuery}
        emptyText=""
      />
    </div>
  );
}
