import { RadioGroup } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Longer explanation, read by screen readers and shown as a tooltip. */
  description?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name of the group. */
  "aria-label": string;
  className?: string;
}

/**
 * Two or three mutually exclusive choices side by side (a radio group drawn as a segmented pill), for rules the
 * user must see and pick explicitly, such as how several selected products combine.
 */
export function SegmentedControl<T extends string>({ value, onValueChange, options, className, ...props }: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      orientation="horizontal"
      className={cn("inline-flex w-full rounded-md border border-line-strong bg-surface-2 p-0.5", className)}
      {...props}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          title={option.description}
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 truncate rounded-[6px] px-3 text-xs font-semibold text-fg-muted transition-[color,background-color,box-shadow] duration-[var(--sf-dur-fast)] ease-spring",
            "hover:text-fg data-[state=checked]:bg-surface data-[state=checked]:text-fg data-[state=checked]:shadow-[0_1px_2px_rgba(29,29,27,0.14)]",
          )}
        >
          <span className="truncate">{option.label}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
