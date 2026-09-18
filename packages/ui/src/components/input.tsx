import { Search, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export const controlBase =
  "w-full min-w-0 rounded-md border border-line-strong bg-surface text-sm text-fg placeholder:text-fg-faint disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-fg-muted read-only:bg-surface-2 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring";

export interface InputProps extends Omit<ComponentProps<"input">, "size"> {
  size?: "sm" | "md" | "lg";
  /** Content rendered inside the field at the left (icon). */
  startSlot?: ReactNode;
  /** Content rendered inside the field at the right (button/adornment). */
  endSlot?: ReactNode;
  wrapperClassName?: string;
}

const sizeClass = { sm: "h-[26px] text-xs", md: "h-[30px]", lg: "h-9 text-base" } as const;

export function Input({ className, size = "md", startSlot, endSlot, wrapperClassName, type = "text", ref, ...props }: InputProps) {
  const input = (
    <input
      ref={ref}
      type={type}
      className={cn(controlBase, sizeClass[size], "px-2.5", startSlot ? "pl-8" : "", endSlot ? "pr-9" : "", className)}
      {...props}
    />
  );
  if (!startSlot && !endSlot) return input;
  return (
    <div className={cn("relative flex w-full items-center", wrapperClassName)}>
      {startSlot ? <span className="pointer-events-none absolute left-2.5 flex text-fg-faint">{startSlot}</span> : null}
      {input}
      {endSlot ? <span className="absolute right-1 flex items-center">{endSlot}</span> : null}
    </div>
  );
}

export interface SearchInputProps extends Omit<InputProps, "type" | "startSlot" | "endSlot" | "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
}

/** Search field with icon and clear button; use inside filter bars. */
export function SearchInput({ value, onValueChange, clearLabel = "Limpar busca", ...props }: SearchInputProps) {
  return (
    <Input
      type="search"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      startSlot={<Search size={14} aria-hidden="true" />}
      endSlot={
        value ? (
          <button
            type="button"
            aria-label={clearLabel}
            className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
            onClick={() => onValueChange("")}
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : null
      }
      {...props}
    />
  );
}

export function Textarea({ className, ref, ...props }: ComponentProps<"textarea">) {
  return <textarea ref={ref} className={cn(controlBase, "min-h-[64px] px-2.5 py-1.5", className)} {...props} />;
}
