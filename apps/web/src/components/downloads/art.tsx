import { cn } from "@salesforce/ui";
import type { CSSProperties, ReactNode } from "react";

/** Own drawings for the downloads centre: phone mockups (CSS), curves and icons (inline SVG). Decorative only; the sample
 *  names, products and values below are illustration, never real data. */

const ORDERS = [
  { name: "Pedido 1042", detail: "Cliente Exemplo A", total: "R$ 1.280,00", status: "Faturado", tone: "bg-[var(--dl-ok-bg)] text-[var(--dl-ok-fg)]" },
  { name: "Pedido 1041", detail: "Cliente Exemplo B", total: "R$ 460,50", status: "Em análise", tone: "bg-[var(--dl-soon-bg)] text-[var(--dl-soon-fg)]" },
  { name: "Pedido 1040", detail: "Cliente Exemplo C", total: "R$ 2.915,90", status: "Enviado", tone: "bg-[var(--sf-accent-weak)] text-[var(--sf-accent-text)]" },
  { name: "Pedido 1039", detail: "Cliente Exemplo D", total: "R$ 980,00", status: "Faturado", tone: "bg-[var(--dl-ok-bg)] text-[var(--dl-ok-fg)]" },
  { name: "Pedido 1038", detail: "Cliente Exemplo E", total: "R$ 1.745,30", status: "Enviado", tone: "bg-[var(--sf-accent-weak)] text-[var(--sf-accent-text)]" },
];

const PRODUCTS = [
  { name: "Forminha floral", tint: "bg-[var(--sf-cta-weak)]" },
  { name: "Caixa presente", tint: "bg-[var(--sf-accent-weak)]" },
  { name: "Balão metalizado", tint: "bg-[var(--dl-soon-bg)]" },
  { name: "Vela de bolo", tint: "bg-[var(--dl-ok-bg)]" },
];

function PhoneChrome({ title, children, active }: { title: string; children: ReactNode; active: number }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[inherit] bg-[var(--sf-bg)] text-[var(--sf-fg)]">
      <div className="border-b-[3px] border-[var(--sf-red)] bg-[var(--sf-navy)] px-[6%] pb-[4%] pt-[9%] text-white">
        <p className="m-0 text-[1.05em] font-extrabold leading-none">{title}</p>
        <div className="mt-[4%] flex items-center gap-[2%] rounded-full bg-white/15 px-[4%] py-[2.4%] text-[0.62em] text-white/85">
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          Buscar pedido ou cliente
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-[3%] overflow-hidden p-[4%]">{children}</div>
      <div className="flex items-center justify-around border-t border-[var(--sf-border)] bg-white py-[3.2%]">
        {["Pedidos", "Catálogo", "Clientes"].map((tab, index) => (
          <span key={tab} className={cn("text-[0.58em] font-bold", index === active ? "text-[var(--sf-accent-text)]" : "text-[var(--sf-fg-faint)]")}>
            {tab}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A phone drawn in CSS showing a sample Force screen. `className` sets the width; the aspect ratio is fixed and all
 * inner sizes scale with the width (font-size is a fraction of it), so one component serves every size.
 */
export function PhoneMock({ className, style, screen = "orders" }: { className?: string; style?: CSSProperties; screen?: "orders" | "catalog" | "order" }) {
  return (
    <div
      aria-hidden="true"
      style={{ containerType: "inline-size", ...style }}
      className={cn("relative aspect-[300/620] w-[300px] rounded-[16%/7.8%] bg-[#0c0c10] p-[2.6%] shadow-[0_40px_90px_-24px_rgb(0_0_0/0.75)]", className)}
    >
      <div className="absolute left-1/2 top-[1.9%] z-10 h-[2.2%] w-[22%] -translate-x-1/2 rounded-full bg-[#0c0c10]" />
      <div className="size-full overflow-hidden rounded-[13%/6.3%] text-[clamp(7px,4.4cqw,14px)]">
        {screen === "orders" ? (
          <PhoneChrome title="Pedidos" active={0}>
            {ORDERS.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-2 rounded-2xl bg-white p-[4%] shadow-sm">
                <div className="min-w-0">
                  <p className="m-0 truncate text-[0.8em] font-bold">{row.name}</p>
                  <p className="m-0 truncate text-[0.66em] text-[var(--sf-fg-muted)]">{row.detail}</p>
                  <p className="m-0 mt-[3%] text-[0.74em] font-semibold">{row.total}</p>
                </div>
                <span className={cn("shrink-0 rounded-full px-[4%] py-[1.6%] text-[0.6em] font-bold", row.tone)}>{row.status}</span>
              </div>
            ))}
          </PhoneChrome>
        ) : null}
        {screen === "catalog" ? (
          <PhoneChrome title="Catálogo" active={1}>
            <div className="grid grid-cols-2 gap-[4%]">
              {PRODUCTS.map((product) => (
                <div key={product.name} className="rounded-2xl bg-white p-[6%] shadow-sm">
                  <div className={cn("grid aspect-square place-items-center rounded-xl", product.tint)}>
                    <svg viewBox="0 0 24 24" className="size-[46%] text-[var(--sf-red-strong)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3c3 3 5 5.6 5 8.5a5 5 0 0 1-10 0C7 8.6 9 6 12 3Z" />
                      <path d="M9 21h6" />
                    </svg>
                  </div>
                  <p className="m-0 mt-[6%] truncate text-[0.66em] font-bold">{product.name}</p>
                  <p className="m-0 text-[0.62em] font-semibold text-[var(--sf-accent-text)]">R$ 12,90</p>
                </div>
              ))}
            </div>
          </PhoneChrome>
        ) : null}
        {screen === "order" ? (
          <PhoneChrome title="Novo pedido" active={0}>
            {["Forminha floral", "Caixa presente", "Vela de bolo"].map((item, index) => (
              <div key={item} className="flex items-center justify-between rounded-2xl bg-white p-[4%] shadow-sm">
                <p className="m-0 text-[0.74em] font-bold">{item}</p>
                <p className="m-0 text-[0.7em] font-semibold text-[var(--sf-fg-muted)]">{`${index + 2} un`}</p>
              </div>
            ))}
            <div className="mt-auto rounded-full bg-[var(--sf-cta)] py-[3.4%] text-center text-[0.78em] font-extrabold text-white">Enviar pedido</div>
          </PhoneChrome>
        ) : null}
      </div>
    </div>
  );
}

/** Bezier curves along the base of a block: a red stroke and a faint white one (login family). Stretches with its parent. */
export function CurveArt({ className, tone = "red" }: { className?: string; tone?: "red" | "white" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 1440 220" preserveAspectRatio="none" className={cn("pointer-events-none absolute inset-x-0 w-full", className)} fill="none">
      <path
        d="M-20 190C260 40 520 60 760 130S1200 210 1460 60"
        stroke={tone === "red" ? "var(--sf-cta)" : "rgb(255 255 255 / 0.28)"}
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
      />
      <path d="M-20 130C300 20 560 40 800 100S1220 170 1460 20" stroke="rgb(255 255 255 / 0.14)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const icon = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function OfflineIcon({ className }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <path d="M7 18h10a4 4 0 0 0 .8-7.9A6 6 0 0 0 6.3 9.3 4.4 4.4 0 0 0 7 18Z" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

export function PhotoIcon({ className }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
    </svg>
  );
}

export function OrderIcon({ className }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <path d="M6 3h8l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5" />
      <path d="m8.5 14.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function UpdateIcon({ className }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <path d="M20 12a8 8 0 0 0-14-5.3L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 12a8 8 0 0 0 14 5.3L20 15" />
      <path d="M20 20v-5h-5" />
    </svg>
  );
}

export function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
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

export function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

export function DesktopIcon({ className }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path d="M9 20h6M12 16v4" />
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
