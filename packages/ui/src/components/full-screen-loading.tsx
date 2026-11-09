import { Check, Send, TriangleAlert } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "../lib/cn";

export interface FullScreenLoadingProps {
  open: boolean;
  /** Called when the screen asks to close (Esc) and it is not `busy`. */
  onClose: () => void;
  /** Accessible name of the screen (read by screen readers, not drawn). */
  title: string;
  /** Accessible name of the progress ring. */
  label: string;
  /** 0-100. Omit it for work without a percentage (sending): the arc keeps turning and a send icon replaces the number. */
  percent?: number;
  /** The single highlighted action line below the ring ("Lendo transportadoras…"). */
  action: ReactNode;
  /** Small, discreet line under the action ("7 de 11 · 2 s"). */
  meta?: ReactNode;
  /** Set when the run ended: the ring completes and turns into a check (ok) or an attention mark (warn). */
  outcome?: "ok" | "warn" | null;
  /** True while the work runs: Esc does not close. */
  busy: boolean;
  /** Actions at the end of the run (Concluir, Tentar de novo, Fechar…). */
  actions?: ReactNode;
  /** Extra content under the action line (alerts, reasons). */
  children?: ReactNode;
  /** Details list. When given, a discreet "Ver detalhes" link opens it in a translucent panel inside the screen. */
  details?: ReactNode;
  detailsOpen?: boolean;
  onDetailsToggle?: () => void;
  detailsId?: string;
  detailsTitle?: string;
  brand?: string;
}

const VIEW = 200;
const STROKE = 12;
const RADIUS = (VIEW - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const RING_SIZE = "clamp(10.5rem, 30vmin, 12.5rem)";

/**
 * Full-screen loading (D-AE): a 100% opaque navy screen, no box, nothing of the page shows through. A progress ring with the
 * percentage in the middle, the action line and a discreet meta line. Radix Dialog underneath keeps the focus trap, aria-modal
 * and the scroll lock; its overlay is a solid colour, never a blur or a scrim.
 */
export function FullScreenLoading({
  open,
  onClose,
  title,
  label,
  percent,
  action,
  meta,
  outcome = null,
  busy,
  actions,
  children,
  details,
  detailsOpen = false,
  onDetailsToggle,
  detailsId = "loading-details",
  detailsTitle = "Andamento por informação",
  brand = "Force PLAC",
}: FullScreenLoadingProps) {
  const gradientId = useId();
  const hasNumber = percent !== undefined;
  const value = outcome ? 100 : Math.max(0, Math.min(100, Math.round(percent ?? 0)));
  const indeterminate = !outcome && (!hasNumber || value <= 0);
  const offset = CIRCUMFERENCE * (1 - value / 100);
  const arcStroke = outcome === "ok" ? "#6ee7a8" : outcome === "warn" ? "#fbbd3a" : `url(#${gradientId})`;
  const hasDetails = details !== undefined && details !== null;

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay data-full-screen-overlay="" className="fixed inset-0 z-[99] bg-[var(--sf-navy-strong)]" />
        <RadixDialog.Content
          data-full-screen-loading=""
          aria-modal="true"
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          style={{ background: "linear-gradient(160deg, var(--sf-navy) 0%, var(--sf-navy-strong) 100%)" }}
          className="fixed inset-0 z-[100] flex flex-col overflow-hidden px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-white outline-none"
        >
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          <p className="m-0 text-center text-xs font-semibold uppercase tracking-[0.25em] text-white/75" aria-hidden="true">
            {brand}
          </p>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center">
            <div
              role="progressbar"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={hasNumber || outcome ? value : undefined}
              aria-valuetext={indeterminate ? (hasNumber ? "Iniciando" : "Em andamento") : `${value}%`}
              data-indeterminate={indeterminate ? "true" : "false"}
              className="relative shrink-0"
              style={{ width: RING_SIZE, height: RING_SIZE }}
            >
              <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
                <defs>
                  <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#dbe4ff" />
                    <stop offset="100%" stopColor="var(--sf-red)" />
                  </linearGradient>
                </defs>
                <circle cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={STROKE} />
                {indeterminate ? null : (
                  <circle
                    data-arc="determinate"
                    cx={VIEW / 2}
                    cy={VIEW / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={arcStroke}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={offset}
                    className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                  />
                )}
              </svg>
              {indeterminate ? (
                <svg
                  data-arc="indeterminate"
                  viewBox={`0 0 ${VIEW} ${VIEW}`}
                  className="absolute inset-0 size-full -rotate-90 animate-spin motion-reduce:hidden"
                  style={{ animationDuration: "1.1s", animationTimingFunction: "linear" }}
                  aria-hidden="true"
                >
                  <circle
                    cx={VIEW / 2}
                    cy={VIEW / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={`url(#${gradientId})`}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE}`}
                  />
                </svg>
              ) : null}
              <div className="absolute inset-0 flex items-center justify-center">
                {outcome === "ok" ? (
                  <Check className="size-[34%] text-[#6ee7a8]" strokeWidth={2.5} aria-hidden="true" data-outcome="ok" />
                ) : outcome === "warn" ? (
                  <TriangleAlert className="size-[32%] text-[#fbbd3a]" strokeWidth={2} aria-hidden="true" data-outcome="warn" />
                ) : !hasNumber ? (
                  <Send className="size-[30%] text-white" strokeWidth={1.75} aria-hidden="true" data-testid="hero-icon" />
                ) : (
                  <span className="font-semibold tabular-nums tracking-tight text-white" style={{ fontSize: "clamp(2.6rem, 8.5vmin, 3.5rem)" }} data-testid="hero-percent">
                    {value}%
                  </span>
                )}
              </div>
            </div>

            <p className="m-0 max-w-md text-balance text-lg font-semibold leading-snug text-white" role="status" aria-live="polite">
              {action}
            </p>
            {meta ? <p className="m-0 -mt-2 max-w-md text-sm tabular-nums text-white/80">{meta}</p> : null}
            {children}
            {hasDetails && !detailsOpen ? (
              <button
                type="button"
                className="text-xs font-medium text-white/80 underline underline-offset-2 hover:text-white focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-expanded={false}
                aria-controls={detailsId}
                onClick={onDetailsToggle}
              >
                Ver detalhes
              </button>
            ) : null}
          </div>
          <div className="flex min-h-12 flex-wrap items-center justify-center gap-2 pt-3" data-full-screen-actions="">
            {actions}
          </div>

          {hasDetails && detailsOpen ? (
            <div className="absolute inset-x-4 bottom-[6rem] top-14 z-10 flex items-center justify-center">
              <div
                id={detailsId}
                role="group"
                aria-label={detailsTitle}
                className="flex max-h-full w-full max-w-[560px] flex-col rounded-xl border border-white/15 bg-[#00082d] text-white"
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-semibold">{detailsTitle}</span>
                  <button
                    type="button"
                    className="text-xs font-medium text-white/80 underline underline-offset-2 hover:text-white focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-expanded
                    aria-controls={detailsId}
                    onClick={onDetailsToggle}
                  >
                    Ocultar detalhes
                  </button>
                </div>
                <div
                  data-details-scroll=""
                  className={cn("flex min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-4 [scrollbar-color:rgba(255,255,255,0.3)_transparent] [scrollbar-width:thin]")}
                >
                  {details}
                </div>
              </div>
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
