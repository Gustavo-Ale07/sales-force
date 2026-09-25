import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/** Visible, explicit filter row above a table (never hidden behind a menu). Unboxed, as in the reference kit. */
export function FilterBar({ className, ...props }: ComponentProps<"form">) {
  return (
    <form
      role="search"
      className={cn("flex flex-wrap items-end gap-3", className)}
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
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
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
