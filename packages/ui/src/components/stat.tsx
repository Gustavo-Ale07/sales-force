import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Tone } from "./badge";

export interface StatTileProps extends Omit<ComponentProps<"div">, "children"> {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** 0-100 progress bar (presentational; pass a value computed by the server/domain). */
  progress?: number;
  /** Value colour only for genuinely negative signals (e.g. errors); default neutral. */
  emphasis?: "default" | "danger";
  /** Optional supporting icon (e.g. lucide, size ~13-14). Purely decorative: never the only signal. */
  icon?: ReactNode;
  /**
   * Colours the icon chip when the figure deserves attention (e.g. blocked customers, a pricing gap).
   * Most tiles stay purely informational and should leave this unset (neutral grey chip).
   */
  tone?: Tone;
}

const toneChip: Record<Tone, string> = {
  neutral: "bg-surface-3 text-fg-muted",
  accent: "bg-accent-weak text-accent-text",
  success: "bg-ok-bg text-ok",
  warning: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

/** Dense KPI tile: small caps label, strong value, muted hint. Colour/icon are opt-in per tile (see `tone`, `icon`). */
export function StatTile({ label, value, hint, progress, emphasis = "default", icon, tone = "neutral", className, ...props }: StatTileProps) {
  return (
    <div className={cn("relative min-w-0 rounded-md border border-line bg-surface px-3 py-2.5", icon && "pr-8", className)} {...props}>
      {icon ? (
        <span
          aria-hidden="true"
          className={cn("absolute right-2.5 top-2.5 inline-flex shrink-0 items-center justify-center rounded-full p-1", toneChip[tone])}
        >
          {icon}
        </span>
      ) : null}
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
