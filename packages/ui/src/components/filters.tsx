import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/** Visible, explicit filter row above a table (never hidden behind a menu). */
export function FilterBar({ className, ...props }: ComponentProps<"form">) {
  return (
    <form
      role="search"
      className={cn("flex flex-wrap items-end gap-2 rounded-md border border-line bg-surface px-3 py-2", className)}
      onSubmit={(event) => event.preventDefault()}
      {...props}
    />
  );
}

export interface FilterFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

/** Compact labelled filter control (label above, small caps). */
export function FilterField({ label, children, className }: FilterFieldProps) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
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
    <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-accent bg-accent-weak pl-2 pr-1 text-xs text-fg">
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
