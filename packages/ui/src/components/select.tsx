import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { controlBase } from "./input";

export interface SelectProps extends Omit<ComponentProps<"select">, "size"> {
  size?: "sm" | "md" | "lg";
  wrapperClassName?: string;
}

const sizeClass = { sm: "h-[26px] text-xs", md: "h-[30px]", lg: "h-9 text-base" } as const;

/** Native select (best keyboard/mobile behaviour and accessibility), styled to match the other controls. */
export function Select({ className, wrapperClassName, size = "md", children, ref, ...props }: SelectProps) {
  return (
    <div className={cn("relative flex w-full min-w-0 items-center", wrapperClassName)}>
      <select ref={ref} className={cn(controlBase, sizeClass[size], "appearance-none pl-2.5 pr-7", className)} {...props}>
        {children}
      </select>
      <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2 text-fg-muted" />
    </div>
  );
}
