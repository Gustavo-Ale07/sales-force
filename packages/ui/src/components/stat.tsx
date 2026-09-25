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
    <div
      className={cn(
        "relative min-w-0 rounded-lg border border-line bg-surface px-5 py-4 shadow-card transition-[border-color,box-shadow] duration-[var(--sf-dur-base)] ease-spring hover:border-line-strong",
        icon && "pr-12",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cn("absolute right-4 top-4 inline-flex shrink-0 items-center justify-center rounded-full p-1.5", toneChip[tone])}
        >
          {icon}
        </span>
      ) : null}
      <div className="text-xs font-medium text-fg-muted">{label}</div>
      <div
        className={cn(
          "mt-2 whitespace-nowrap text-[22px] font-semibold sm:text-[26px] leading-none tracking-[-0.02em]",
          emphasis === "danger" ? "text-danger" : "text-fg",
        )}
      >
        {value}
      </div>
      {progress !== undefined ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(100, Math.max(0, progress)))}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"
        >
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      ) : null}
      {hint ? <div className="mt-1.5 text-xs text-fg-muted">{hint}</div> : null}
    </div>
  );
}

export function StatGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3", className)} {...props} />;
}
