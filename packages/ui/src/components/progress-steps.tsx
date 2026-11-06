import { Check, Minus, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

export type StepState = "pending" | "running" | "done" | "failed" | "skipped";

export interface ProgressStepsProps {
  /** 0-100. */
  value: number;
  /** Accessible name of the bar ("Progresso da atualização"). */
  label: string;
  /** Text above the bar, left ("Atualizando preços…"). */
  caption?: ReactNode;
  /** Text above the bar, right ("5 de 10"). */
  summary?: ReactNode;
  /** `danger` when the run ended with a failure. */
  tone?: "accent" | "ok" | "warn";
  className?: string;
}

/** Progress bar with a caption and an optional "n de N" summary. One `progressbar` role, so it is announced once. */
export function ProgressSteps({ value, label, caption, summary, tone = "accent", className }: ProgressStepsProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {caption || summary ? (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 font-medium text-fg">{caption}</span>
          <span className="shrink-0 tabular-nums text-fg-muted">{summary}</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[var(--sf-dur-slow)] ease-out motion-reduce:transition-none",
            tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-[var(--sf-navy)]",
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

const STATE_LABEL: Record<StepState, string> = {
  pending: "Aguardando",
  running: "Em andamento",
  done: "Concluído",
  failed: "Falhou",
  skipped: "Não aplicável",
};

/** Fixed-size (20px) state icon: the row never shifts when the state changes. */
export function StepIcon({ state }: { state: StepState }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" role="img" aria-label={STATE_LABEL[state]}>
      {state === "running" ? (
        <Spinner size={16} className="text-[var(--sf-navy)]" />
      ) : state === "done" ? (
        <Check size={16} strokeWidth={2.25} className="text-ok" aria-hidden="true" />
      ) : state === "failed" ? (
        <X size={16} strokeWidth={2.25} className="text-danger" aria-hidden="true" />
      ) : state === "skipped" ? (
        <Minus size={16} strokeWidth={2} className="text-fg-faint" aria-hidden="true" />
      ) : (
        <span className="size-2 rounded-full bg-line-strong" aria-hidden="true" />
      )}
    </span>
  );
}

export interface StepRowProps {
  state: StepState;
  label: string;
  /** Right-hand value (a count). Tabular numerals. */
  value?: ReactNode;
  /** Short second line (a masked reason). It wraps inside the row; it never pushes the value out of line. */
  note?: ReactNode;
  className?: string;
}

/** One line of a progress list: icon, name on the left, value on the right, optional small second line. */
export function StepRow({ state, label, value, note, className }: StepRowProps) {
  return (
    <li
      data-state={state}
      className={cn(
        "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2 py-1.5 text-sm",
        state === "running" && "bg-surface-2",
        state === "skipped" && "text-fg-muted",
        className,
      )}
    >
      <StepIcon state={state} />
      <span className={cn("min-w-0 font-medium", state === "skipped" ? "text-fg-muted" : "text-fg", state === "pending" && "text-fg-muted")}>{label}</span>
      <span className="text-right tabular-nums text-fg-muted">{value}</span>
      {note ? <span className="col-start-2 col-end-4 mt-0.5 text-xs leading-snug text-fg-muted">{note}</span> : null}
    </li>
  );
}

export interface StepGroupProps {
  title: string;
  children: ReactNode;
  className?: string;
}

/** A titled block of `StepRow`s. */
export function StepGroup({ title, children, className }: StepGroupProps) {
  return (
    <section className={cn("flex flex-col gap-0.5", className)}>
      <h3 className="m-0 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{children}</ul>
    </section>
  );
}

/** Closing mark of a run: success or attention, larger than a row icon. */
export function OutcomeMark({ tone }: { tone: "ok" | "warn" }) {
  return (
    <span
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", tone === "ok" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn")}
      role="img"
      aria-label={tone === "ok" ? "Concluído" : "Atenção"}
    >
      {tone === "ok" ? <Check size={22} strokeWidth={2.25} aria-hidden="true" /> : <TriangleAlert size={22} strokeWidth={2} aria-hidden="true" />}
    </span>
  );
}
