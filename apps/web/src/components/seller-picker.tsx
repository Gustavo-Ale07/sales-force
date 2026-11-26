import { Combobox, type ComboboxProps } from "@salesforce/ui";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { filterSellers, type SearchableSeller } from "../lib/seller-search";

export interface SellerPickerProps
  extends Omit<ComboboxProps, "options" | "value" | "onValueChange" | "onSearchChange" | "emptyText" | "wrapperClassName" | "placeholder"> {
  sellers: readonly SearchableSeller[];
  /** Selected seller code, or null. */
  value: number | null;
  onChange: (code: number | null) => void;
}

/** The one seller chooser of the site: search box with magnifier, accent/case-insensitive, alphabetical. Same behavior as the app. */
export function SellerPicker({ sellers, value, onChange, className, ...props }: SellerPickerProps) {
  const [query, setQuery] = useState("");
  // Combobox async mode (it does not filter itself): the list is filtered here with the accent-insensitive search.
  const options = useMemo(() => filterSellers(sellers, query).map((seller) => ({ value: String(seller.code), label: seller.name })), [sellers, query]);
  return (
    // The Combobox resets its own text on blur/Escape without telling us: mirror that so the list is whole again.
    <div
      role="presentation"
      className="relative w-full min-w-0"
      onBlur={() => setQuery("")}
      onKeyDown={(event) => {
        if (event.key === "Escape") setQuery("");
      }}
    >
      <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-fg-muted" />
      <Combobox
        {...props}
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
