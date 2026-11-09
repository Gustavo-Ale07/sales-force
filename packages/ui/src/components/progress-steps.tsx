import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

export type StepState = "pending" | "running" | "done" | "failed" | "skipped";

/** `dark` is for lists drawn over the navy full-screen loading (FullScreenLoading). */
export type StepTone = "light" | "dark";

const STATE_LABEL: Record<StepState, string> = {
  pending: "Aguardando",
  running: "Em andamento",
  done: "Concluído",
  failed: "Falhou",
  skipped: "Não aplicável",
};

/** Fixed-size (20px) state icon: the row never shifts when the state changes. The state is the icon; there is no count (D-AF). */
export function StepIcon({ state, tone = "light" }: { state: StepState; tone?: StepTone }) {
  const dark = tone === "dark";
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" role="img" aria-label={STATE_LABEL[state]}>
      {state === "running" ? (
        <Spinner size={16} className={dark ? "text-white" : "text-[var(--sf-navy)]"} />
      ) : state === "done" ? (
        <Check size={16} strokeWidth={2.25} className={dark ? "text-[#86efac]" : "text-ok"} aria-hidden="true" />
      ) : state === "failed" ? (
        <X size={16} strokeWidth={2.25} className={dark ? "text-[#fca5a5]" : "text-danger"} aria-hidden="true" />
      ) : state === "skipped" ? (
        <Minus size={16} strokeWidth={2} className={dark ? "text-white/60" : "text-fg-faint"} aria-hidden="true" />
      ) : (
        <span className={cn("size-2.5 rounded-full border", dark ? "border-white/60" : "border-line-strong")} aria-hidden="true" />
      )}
    </span>
  );
}

export interface StepRowProps {
  state: StepState;
  label: string;
  /** Short second line (a masked reason). It wraps inside the row. */
  note?: ReactNode;
  tone?: StepTone;
  className?: string;
}

/** One line of a progress list: state icon, name, optional small second line. No number on the right (D-AF). */
export function StepRow({ state, label, note, tone = "light", className }: StepRowProps) {
  const dark = tone === "dark";
  return (
    <li
      data-state={state}
      className={cn(
        "grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 rounded-md px-2 py-1.5 text-sm",
        state === "running" && (dark ? "bg-white/10" : "bg-surface-2"),
        className,
      )}
    >
      <StepIcon state={state} tone={tone} />
      <span
        className={cn(
          "min-w-0 font-medium",
          dark ? (state === "pending" || state === "skipped" ? "text-white/75" : "text-white") : state === "pending" || state === "skipped" ? "text-fg-muted" : "text-fg",
        )}
      >
        {label}
      </span>
      {note ? <span className={cn("col-start-2 mt-0.5 text-xs leading-snug", dark ? (state === "skipped" ? "text-white/60" : "text-[#fde68a]") : "text-fg-muted")}>{note}</span> : null}
    </li>
  );
}

export interface StepGroupProps {
  title: string;
  children: ReactNode;
  tone?: StepTone;
  className?: string;
}

/** A titled block of `StepRow`s. */
export function StepGroup({ title, children, tone = "light", className }: StepGroupProps) {
  return (
    <section className={cn("flex flex-col gap-0.5", className)}>
      <h3 className={cn("m-0 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider", tone === "dark" ? "text-white/75" : "text-fg-muted")}>{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{children}</ul>
    </section>
  );
}
