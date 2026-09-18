import { Check, ChevronDown } from "lucide-react";
import { useId, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { controlBase } from "./input";
import { Spinner } from "./spinner";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps
  extends Omit<ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "size" | "role" | "type"> {
  options: ComboboxOption[];
  /** Selected option value, or null. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  /**
   * Async mode: called with the typed query (the caller debounces and fetches). When provided, options are
   * NOT filtered locally.
   */
  onSearchChange?: (query: string) => void;
  loading?: boolean;
  emptyText?: string;
  loadingText?: string;
  size?: "sm" | "md" | "lg";
  wrapperClassName?: string;
}

const sizeClass = { sm: "h-[26px] text-xs", md: "h-[30px]", lg: "h-9 text-base" } as const;

/** ARIA 1.2 combobox (editable, list autocomplete): search-select for customers, products, sellers... */
export function Combobox({
  options,
  value,
  onValueChange,
  onSearchChange,
  loading = false,
  emptyText = "Nenhum resultado",
  loadingText = "Buscando…",
  size = "md",
  className,
  wrapperClassName,
  disabled,
  ...props
}: ComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => {
    if (onSearchChange || !query) return options;
    const needle = query.toLocaleLowerCase("pt-BR");
    return options.filter((o) => `${o.label} ${o.description ?? ""}`.toLocaleLowerCase("pt-BR").includes(needle));
  }, [options, query, onSearchChange]);

  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));

  const commit = (option: ComboboxOption) => {
    if (option.disabled) return;
    onValueChange(option.value);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Enter": {
        const option = filtered[activeIndex];
        if (open && option) {
          event.preventDefault();
          commit(option);
        }
        break;
      }
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
          setQuery("");
        }
        break;
      case "Backspace":
        if (!query && selected) onValueChange(null);
        break;
      default:
    }
  };

  const activeId = open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  return (
    <div
      ref={rootRef}
      className={cn("relative w-full min-w-0", wrapperClassName)}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <input
        {...props}
        role="combobox"
        type="text"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        disabled={disabled}
        className={cn(controlBase, sizeClass[size], "pl-2.5 pr-8", className)}
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
          onSearchChange?.(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted">
        {loading ? <Spinner /> : <ChevronDown size={14} aria-hidden="true" />}
      </span>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-busy={loading || undefined}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border border-line-strong bg-surface py-1 shadow-pop"
        >
          {filtered.map((option, index) => (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard handled by the combobox input (aria-activedescendant)
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 px-2.5 py-1.5 text-sm",
                index === activeIndex && "bg-accent-weak",
                option.disabled && "cursor-not-allowed text-fg-faint",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(option)}
            >
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.description ? <span className="block truncate text-xs text-fg-muted">{option.description}</span> : null}
              </span>
              {option.value === value ? <Check size={14} aria-hidden="true" className="shrink-0 text-accent" /> : null}
            </li>
          ))}
          {filtered.length === 0 ? (
            <li role="presentation" className="px-2.5 py-2 text-sm text-fg-muted">
              {loading ? loadingText : emptyText}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
