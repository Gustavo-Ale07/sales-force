import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export interface SpinnerProps extends Omit<ComponentProps<"span">, "children"> {
  /** Accessible label; when omitted the spinner is decorative. */
  label?: string;
  size?: number;
}

export function Spinner({ label, size = 14, className, ...props }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex shrink-0 items-center", className)}
      {...props}
    >
      <Loader2 width={size} height={size} className="animate-spin" aria-hidden="true" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
