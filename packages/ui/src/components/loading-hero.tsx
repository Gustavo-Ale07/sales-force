import { Check, Send, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "../lib/cn";

export interface LoadingHeroProps {
  /** 0-100. Omit it for work that has no percentage (sending): the arc keeps turning and a send icon replaces the number. While it is 0 and nothing finished, the arc is indeterminate (a short arc turning around the ring). */
  percent?: number;
  /** Accessible name of the progress ring. */
  label: string;
  /** The single highlighted action line below the ring ("Atualizando preços…"). */
  action: ReactNode;
  /** Small, discreet line under the action ("3 de 11 · 12 s"). */
  meta?: ReactNode;
  /** Set when the run ended: the ring completes and turns into a check (ok) or an attention mark (warn). */
  outcome?: "ok" | "warn" | null;
  className?: string;
}

const SIZE = 136;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Progress ring with the percentage in the middle (D-AC 2i D1). Light theme: a very light track under an arc with a
 * navy-to-red gradient that grows with a smooth transition. At 0% the arc is indeterminate so it never looks stuck;
 * with `prefers-reduced-motion` the turning arc is hidden and only the determinate arc and the number remain.
 */
export function LoadingHero({ percent, label, action, meta, outcome = null, className }: LoadingHeroProps) {
  const gradientId = useId();
  const hasNumber = percent !== undefined;
  const value = outcome ? 100 : Math.max(0, Math.min(100, Math.round(percent ?? 0)));
  const indeterminate = !outcome && (!hasNumber || value <= 0);
  const offset = CIRCUMFERENCE * (1 - value / 100);
  const outcomeColor = outcome === "ok" ? "var(--color-ok)" : outcome === "warn" ? "var(--color-warn)" : null;

  return (
    <div className={cn("flex flex-col items-center gap-3 text-center", className)} data-loading-hero="">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hasNumber || outcome ? value : undefined}
        aria-valuetext={indeterminate ? (hasNumber ? "Iniciando" : "Em andamento") : `${value}%`}
        data-indeterminate={indeterminate ? "true" : "false"}
        className="relative shrink-0"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--sf-navy)" />
              <stop offset="100%" stopColor="var(--sf-red-strong)" />
            </linearGradient>
          </defs>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--color-surface-3)" strokeWidth={STROKE} />
          {indeterminate ? null : (
            <circle
              data-arc="determinate"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={outcomeColor ?? `url(#${gradientId})`}
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
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="absolute inset-0 -rotate-90 animate-spin motion-reduce:hidden"
            style={{ animationDuration: "1.1s", animationTimingFunction: "linear" }}
            aria-hidden="true"
          >
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
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
            <Check size={52} strokeWidth={2.5} className="text-ok" aria-hidden="true" data-outcome="ok" />
          ) : outcome === "warn" ? (
            <TriangleAlert size={48} strokeWidth={2} className="text-warn" aria-hidden="true" data-outcome="warn" />
          ) : !hasNumber ? (
            <Send size={44} strokeWidth={1.75} style={{ color: "var(--sf-navy)" }} aria-hidden="true" data-testid="hero-icon" />
          ) : (
            <span className="text-4xl font-semibold tabular-nums tracking-tight text-fg" data-testid="hero-percent">
              {value}%
            </span>
          )}
        </div>
      </div>
      <p className="m-0 text-base font-semibold text-fg" role="status" aria-live="polite">
        {action}
      </p>
      {meta ? <p className="m-0 -mt-1.5 text-xs tabular-nums text-fg-muted">{meta}</p> : null}
    </div>
  );
}
