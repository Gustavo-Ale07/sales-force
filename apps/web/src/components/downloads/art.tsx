import { cn } from "@salesforce/ui";
import type { CSSProperties, ReactNode } from "react";

/** Own drawings for the downloads centre: phone and browser mockups (CSS), floating objects and icons (SVG). Decorative only. */

const ROWS = [
  { name: "Pedido 1042", detail: "Cliente Exemplo A", total: "R$ 1.280,00", status: "Faturado", tone: "bg-[var(--sf-ok-bg)] text-[var(--sf-ok)]" },
  { name: "Pedido 1041", detail: "Cliente Exemplo B", total: "R$ 460,50", status: "Em análise", tone: "bg-[var(--sf-warn-bg)] text-[var(--sf-warn)]" },
  { name: "Pedido 1040", detail: "Cliente Exemplo C", total: "R$ 2.915,90", status: "Enviado", tone: "bg-[var(--sf-info-bg)] text-[var(--sf-info)]" },
  { name: "Pedido 1039", detail: "Cliente Exemplo D", total: "R$ 735,00", status: "Rascunho", tone: "bg-[var(--sf-neutral-bg)] text-[var(--sf-neutral)]" },
  { name: "Pedido 1038", detail: "Cliente Exemplo E", total: "R$ 98,40", status: "Faturado", tone: "bg-[var(--sf-ok-bg)] text-[var(--sf-ok)]" },
];

/** A phone drawn in CSS with an example order list (no real data). `className` sets the width; the aspect ratio is fixed. */
export function PhoneMock({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn(
        "relative aspect-[9/18.5] w-[260px] rounded-[38px] border-[7px] border-[var(--dl-ink)] bg-[var(--dl-ink)] shadow-[0_30px_80px_-20px_rgba(0,0,40,0.7)]",
        className,
      )}
    >
      <div className="absolute left-1/2 top-2 z-10 h-[14px] w-[64px] -translate-x-1/2 rounded-full bg-[var(--dl-ink)]" />
      <div className="flex h-full flex-col overflow-hidden rounded-[31px] bg-[var(--sf-bg)] text-[var(--sf-fg)]">
        <div className="flex items-center justify-between bg-[var(--sf-navy)] px-5 pb-3 pt-7 text-white">
          <span className="text-[10px] font-semibold opacity-90">9:41</span>
          <span className="flex gap-1 opacity-90">
            <span className="h-[7px] w-[11px] rounded-[2px] bg-white" />
            <span className="h-[7px] w-[7px] rounded-full bg-white" />
          </span>
        </div>
        <div className="border-b-[3px] border-[var(--sf-red)] bg-[var(--sf-navy)] px-4 pb-4 text-white">
          <p className="m-0 text-[17px] font-extrabold leading-none">Pedidos</p>
          <div className="mt-3 flex items-center gap-2 rounded-full bg-white/15 px-3 py-2 text-[11px] text-white/80">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            Buscar pedido ou cliente
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-hidden p-3">
          {ROWS.map((row) => (
            <div key={row.name} className="flex items-center justify-between gap-2 rounded-2xl bg-white p-3 shadow-sm">
              <div className="min-w-0">
                <p className="m-0 truncate text-[12px] font-bold">{row.name}</p>
                <p className="m-0 truncate text-[10px] text-[var(--sf-fg-muted)]">{row.detail}</p>
                <p className="m-0 mt-1 text-[11px] font-semibold">{row.total}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-1 text-[9px] font-bold", row.tone)}>{row.status}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-around border-t border-[var(--sf-border)] bg-white py-2.5">
          {["Pedidos", "Catálogo", "Clientes"].map((tab, index) => (
            <span key={tab} className={cn("text-[9px] font-bold", index === 0 ? "text-[var(--sf-accent-text)]" : "text-[var(--sf-fg-faint)]")}>
              {tab}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A browser window drawn in CSS with an app-like layout (placeholder bars, no data). */
export function BrowserMock({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("w-full overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_-20px_rgba(0,0,40,0.7)]", className)}>
      <div className="flex items-center gap-3 bg-[var(--sf-surface-3)] px-4 py-3">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[var(--sf-red-strong)]" />
          <span className="size-2.5 rounded-full bg-[var(--sf-warn)]" />
          <span className="size-2.5 rounded-full bg-[var(--sf-ok)]" />
        </span>
        <span className="flex h-6 flex-1 items-center gap-2 rounded-full bg-white px-3 text-[11px] font-semibold text-[var(--sf-fg-muted)]">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Force
        </span>
      </div>
      <div className="flex h-[250px] sm:h-[300px]">
        <div className="flex w-[26%] flex-col gap-2 bg-[var(--sf-navy)] p-3">
          <span className="mb-1 h-5 w-10 rounded-md bg-[var(--sf-red)]" />
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={cn("h-3 rounded-full", n === 2 ? "bg-white" : "bg-white/30")} style={{ width: `${90 - n * 8}%` }} />
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-2.5 bg-[var(--sf-bg)] p-3 sm:p-4">
          <div className="flex gap-2">
            {[0, 1, 2].map((n) => (
              <div key={n} className="flex-1 rounded-xl bg-white p-2.5 shadow-sm">
                <span className="block h-2 w-8 rounded-full bg-[var(--sf-border-strong)]" />
                <span className="mt-2 block h-4 w-12 rounded-md bg-[var(--sf-cta)]" />
              </div>
            ))}
          </div>
          <div className="flex-1 rounded-xl bg-white p-3 shadow-sm">
            {[0, 1, 2, 3, 4].map((n) => (
              <div key={n} className="flex items-center gap-2 border-b border-[var(--sf-border)] py-2 last:border-0">
                <span className="h-2.5 w-[22%] rounded-full bg-[var(--sf-border-strong)]" />
                <span className="h-2.5 flex-1 rounded-full bg-[var(--sf-surface-3)]" />
                <span className={cn("h-3.5 w-10 rounded-full", n % 2 ? "bg-[var(--sf-warn-bg)]" : "bg-[var(--sf-ok-bg)]")} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Order box with a check mark: floating decoration. */
export function OrderBoxArt({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 120" className={className} style={style} fill="none">
      <path d="M60 10 108 34v52L60 110 12 86V34L60 10Z" fill="var(--sf-surface-2)" />
      <path d="M60 10 108 34 60 58 12 34 60 10Z" fill="var(--sf-surface)" />
      <path d="M60 58v52L12 86V34l48 24Z" fill="var(--sf-surface-3)" />
      <path d="M60 58v52l48-24V34L60 58Z" fill="var(--sf-border-strong)" />
      <path d="m36 22 48 24v14l-12-6V50L24 28l12-6Z" fill="var(--sf-red-strong)" />
      <circle cx="84" cy="88" r="20" fill="var(--sf-fg)" stroke="#ffffff" strokeWidth="5" />
      <path d="m74 88 7 7 13-14" stroke="#ffffff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Speech bubble with a check mark: floating decoration. */
export function BubbleArt({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 110" className={className} style={style} fill="none">
      <path d="M20 8h80a14 14 0 0 1 14 14v46a14 14 0 0 1-14 14H64L38 104V82H20A14 14 0 0 1 6 68V22A14 14 0 0 1 20 8Z" fill="#ffffff" />
      <rect x="24" y="28" width="52" height="8" rx="4" fill="var(--sf-border-strong)" />
      <rect x="24" y="46" width="34" height="8" rx="4" fill="var(--sf-surface-3)" />
      <circle cx="90" cy="46" r="16" fill="var(--sf-red-strong)" />
      <path d="m82 46 6 6 11-12" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Gear: floating decoration for the test-version block. */
export function GearArt({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className={className} style={style} fill="none">
      {[0, 45, 90, 135].map((angle) => (
        <rect key={angle} x="42" y="4" width="16" height="92" rx="5" fill="#ffffff" transform={`rotate(${angle} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="34" fill="#ffffff" />
      <circle cx="50" cy="50" r="15" fill="var(--sf-red-strong)" />
    </svg>
  );
}

/** Soft blurred shape for backgrounds. */
export function Blob({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("pointer-events-none absolute rounded-full blur-3xl", className)} />;
}

const iconProps = {
  viewBox: "0 0 64 64",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 3.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function OfflineIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M18 44h28a10 10 0 0 0 2-19.8A14 14 0 0 0 21 21a12 12 0 0 0-3 23Z" />
      <path d="M10 10l44 44" stroke="var(--sf-cta-weak)" />
    </svg>
  );
}

export function PhotoIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="8" y="12" width="48" height="40" rx="8" />
      <circle cx="22" cy="26" r="5" />
      <path d="m10 46 14-13 10 9 8-7 12 11" />
    </svg>
  );
}

export function OrderIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M16 8h24l10 10v34a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z" />
      <path d="M40 8v10h10" />
      <path d="m22 38 7 7 13-14" stroke="var(--sf-cta-weak)" />
    </svg>
  );
}

export function UpdateIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M52 30a20 20 0 0 0-36-10l-4 5" />
      <path d="M12 12v13h13" />
      <path d="M12 34a20 20 0 0 0 36 10l4-5" stroke="var(--sf-cta-weak)" />
      <path d="M52 52V39H39" stroke="var(--sf-cta-weak)" />
    </svg>
  );
}

export function AndroidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.5 8.2a5.5 5.5 0 0 0-11 0h11ZM7 8.2V16a1.5 1.5 0 0 0 1.5 1.5H9V20a1.2 1.2 0 0 0 2.4 0v-2.5h1.2V20a1.2 1.2 0 0 0 2.4 0v-2.5h.5A1.5 1.5 0 0 0 17 16V8.2H7Zm-3 .6a1.2 1.2 0 0 0-1.2 1.2v5a1.2 1.2 0 0 0 2.4 0v-5A1.2 1.2 0 0 0 4 8.8Zm16 0a1.2 1.2 0 0 0-1.2 1.2v5a1.2 1.2 0 0 0 2.4 0v-5A1.2 1.2 0 0 0 20 8.8Z" />
    </svg>
  );
}

export function Section({ id, className, children, labelledBy }: { id?: string; className?: string; children: ReactNode; labelledBy?: string }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn("relative scroll-mt-4 overflow-hidden px-5 py-16 sm:px-8 md:py-20", className)}>
      {children}
    </section>
  );
}
