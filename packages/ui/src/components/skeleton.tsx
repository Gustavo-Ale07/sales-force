import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("h-2.5 animate-pulse rounded-sm bg-surface-3", className)} {...props} />;
}

export interface SkeletonLinesProps {
  lines?: number;
  className?: string;
  /** Accessible status text announced to assistive technology. */
  label?: string;
}

const widths = ["w-[90%]", "w-[70%]", "w-[84%]", "w-[60%]", "w-[78%]"];

/** Block placeholder for text/list loading states. */
export function SkeletonLines({ lines = 4, className, label = "Carregando…" }: SkeletonLinesProps) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-2.5", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={widths[i % widths.length]} />
      ))}
    </div>
  );
}
