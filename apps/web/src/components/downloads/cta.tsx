import { cn } from "@salesforce/ui";
import type { DownloadItem } from "../../lib/downloads";

/** Shared pill look: every button on this page is fully rounded, at least 48px tall (touch target). */
const PILL =
  "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full px-7 text-base font-extrabold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";
/** Red call to action (works on blue and on light). */
export const PILL_SOLID = `${PILL} bg-[var(--sf-cta)] text-white shadow-[0_20px_44px_-18px_rgb(217_26_36/0.7)] hover:bg-[var(--sf-red-strong-hover)] focus-visible:ring-[var(--dl-red-soft)] focus-visible:ring-offset-[var(--dl-night)]`;
/** White pill (header "Entrar", final call). */
export const PILL_WHITE = `${PILL} bg-white text-[var(--sf-navy)] hover:bg-[var(--sf-cta-weak)] focus-visible:ring-white focus-visible:ring-offset-[var(--dl-night)]`;
/** Outline on the blue hero. */
export const PILL_GHOST = `${PILL} border-2 border-white/35 text-white hover:bg-white/10 focus-visible:ring-white focus-visible:ring-offset-[var(--dl-night)]`;
/** Outline on light surfaces. */
export const PILL_OUTLINE = `${PILL} border-2 border-[var(--sf-navy)] text-[var(--sf-navy)] hover:bg-[var(--sf-navy)] hover:text-white focus-visible:ring-[var(--sf-navy)] focus-visible:ring-offset-white`;
/** Disabled (coming soon). */
export const PILL_OFF = `${PILL} cursor-not-allowed border-2 border-[var(--sf-border-strong)] bg-transparent text-[var(--sf-fg-muted)]`;

export type PublishedState = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ready"; item: DownloadItem };

/** Skeleton pill shown while the index loads, in place of a download button. */
export function CtaSkeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-14 w-64 animate-pulse rounded-full bg-white/20", className)} />;
}
