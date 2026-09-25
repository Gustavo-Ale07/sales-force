import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { controlBase } from "./input";

export interface SelectProps extends Omit<ComponentProps<"select">, "size"> {
  size?: "sm" | "md" | "lg";
  wrapperClassName?: string;
}

const sizeClass = { sm: "h-8 text-xs", md: "h-10", lg: "h-12 text-base" } as const;

/** Native select (best keyboard/mobile behaviour and accessibility), styled to match the other controls. */
export function Select({ className, wrapperClassName, size = "md", children, ref, ...props }: SelectProps) {
  return (
    <div className={cn("relative flex w-full min-w-0 items-center", wrapperClassName)}>
      <select ref={ref} className={cn(controlBase, sizeClass[size], "appearance-none pl-3 pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute right-3 text-fg-muted" />
    </div>
  );
}
