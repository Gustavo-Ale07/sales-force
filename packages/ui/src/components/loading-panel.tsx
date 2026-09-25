import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "./skeleton";
import { Spinner } from "./spinner";

const widths = ["w-[90%]", "w-[70%]", "w-[84%]", "w-[60%]", "w-[78%]"];

export interface LoadingPanelProps {
  title: string;
  description?: ReactNode;
  /** Placeholder lines under the message; 0 for the message alone. */
  lines?: number;
  className?: string;
}

/**
 * Loading screen for a section or page: what is happening, a spinner and placeholder lines. One status
 * region, so it is announced once.
 */
export function LoadingPanel({ title, description, lines = 5, className }: LoadingPanelProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("flex animate-sf-fade-in flex-col gap-5", className)}>
      <div className="flex items-center gap-3">
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-weak text-accent">
          <Spinner size={18} />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-fg">{title}</p>
          {description ? <p className="m-0 text-xs text-fg-muted">{description}</p> : null}
        </div>
      </div>
      {lines > 0 ? (
        <div aria-hidden="true" className="flex flex-col gap-2.5">
          {Array.from({ length: lines }, (_, i) => (
            <Skeleton key={i} className={widths[i % widths.length]} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
