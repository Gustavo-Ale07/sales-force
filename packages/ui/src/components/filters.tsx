import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Visible, explicit filter row above a table (never hidden behind a menu). Unboxed, as in the reference kit.
 * With `grid` the fields sit on a 12-column grid (1 column on phones, 2 on tablets): give each field a
 * `lg:col-span-*` so every row adds up to 12 and the bar has no gaps.
 */
export function FilterBar({ className, grid, activeCount, children, ...props }: ComponentProps<"form"> & { grid?: boolean; activeCount?: number }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const layout = grid ? "grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-12" : "flex flex-wrap items-end gap-3";
  if (activeCount === undefined) {
    return (
      <form role="search" className={cn(layout, className)} onSubmit={(event) => event.preventDefault()} {...props}>
        {children}
      </form>
    );
  }
  // Collapsible below 640px: the list comes first, the fields sit behind a "Filtros" button with the active count.
  return (
    <form role="search" className={cn("flex flex-col gap-3", className)} onSubmit={(event) => event.preventDefault()} {...props}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold sm:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal size={15} aria-hidden="true" />
          {activeCount > 0 ? `Filtros (${activeCount})` : "Filtros"}
        </span>
        <ChevronDown size={15} aria-hidden="true" className={open ? "rotate-180" : undefined} />
      </button>
      <div id={bodyId} className={cn(layout, !open && "max-sm:[&>*:not([data-keep])]:hidden")}>
        {children}
      </div>
    </form>
  );
}

export interface FilterFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  /** Stays visible while a collapsible FilterBar is closed (below 640px), e.g. the search field. */
  keepVisible?: boolean;
}

/** Compact labelled filter control (label above, small caps). */
export function FilterField({ label, children, className, keepVisible }: FilterFieldProps) {
  return (
    <label data-keep={keepVisible ? "" : undefined} className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

export interface FilterChipProps {
  children: ReactNode;
  onRemove: () => void;
  removeLabel?: string;
}

/** Active-filter chip with remove button. */
export function FilterChip({ children, onRemove, removeLabel = "Remover filtro" }: FilterChipProps) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-weak pl-3 pr-1.5 text-xs font-semibold text-accent-text">
      {children}
      <button
        type="button"
        aria-label={`${removeLabel}: ${typeof children === "string" ? children : ""}`.trim()}
        onClick={onRemove}
        className="flex size-4 items-center justify-center rounded-full text-fg-muted hover:bg-surface-3 hover:text-fg"
      >
        <X size={11} aria-hidden="true" />
      </button>
    </span>
  );
}
