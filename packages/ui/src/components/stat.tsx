import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface StatTileProps extends Omit<ComponentProps<"div">, "children"> {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** 0-100 progress bar (presentational; pass a value computed by the server/domain). */
  progress?: number;
  /** Value colour only for genuinely negative signals (e.g. errors); default neutral. */
  emphasis?: "default" | "danger";
}

/** Restrained KPI tile: small caps label, strong value, muted hint. No colour fills or icons. */
export function StatTile({ label, value, hint, progress, emphasis = "default", className, ...props }: StatTileProps) {
  return (
    <div className={cn("min-w-0 rounded-md border border-line bg-surface px-3 py-2.5", className)} {...props}>
      <div className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={cn("mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight", emphasis === "danger" ? "text-danger" : "text-fg")}>
        {value}
      </div>
      {progress !== undefined ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(100, Math.max(0, progress)))}
          className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-surface-3"
        >
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      ) : null}
      {hint ? <div className="mt-1 text-xs text-fg-muted">{hint}</div> : null}
    </div>
  );
}

export function StatGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5", className)} {...props} />;
}
