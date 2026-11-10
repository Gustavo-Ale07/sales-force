/**
 * ERP release (liberação) of a sent order, read from the last server snapshot of the order (`erpRelease`). Display only:
 * the server decides; this never computes a state. "Aguardando liberação" is the NORMAL state of a sent order, so its
 * text is calm. The snapshot is untyped JSON, so every field is checked.
 */
export type ReleaseTone = "warning" | "success" | "danger" | "info" | "neutral";

export interface ReleaseView {
  readonly label: string;
  readonly message: string;
  readonly tone: ReleaseTone;
  /** Reason per release event (description + state); empty on a list-shaped snapshot. */
  readonly events: readonly string[];
}

const VIEWS = {
  awaiting: { label: "Aguardando liberação", message: "Enviado ao Sankhya, aguardando liberação.", tone: "warning" },
  released: { label: "Liberado", message: "Liberado no Sankhya.", tone: "success" },
  denied: { label: "Negado", message: "A liberação foi negada no Sankhya.", tone: "danger" },
} as const;

type State = keyof typeof VIEWS;

function isState(value: unknown): value is State {
  return value === "awaiting" || value === "released" || value === "denied";
}

/** Billing (faturamento) states of `erpBilling`; same labels and tones as the web (`erpBillingLabels`). */
const BILLING = {
  cancelled: { label: "Cancelado", message: "O pedido foi cancelado no Sankhya.", tone: "neutral" },
  denied: { label: "Negado", message: "A liberação foi negada no Sankhya.", tone: "danger" },
  awaiting_release: { label: "Aguardando liberação", message: "Enviado ao Sankhya, aguardando liberação.", tone: "warning" },
  invoiced: { label: "Faturado", message: "O pedido foi faturado no Sankhya.", tone: "success" },
  awaiting_billing: { label: "Aguardando faturamento", message: "Liberado e confirmado; aguardando o faturamento.", tone: "info" },
  sent: { label: "Enviado (sem confirmação)", message: "Enviado ao Sankhya, ainda sem confirmação da nota.", tone: "neutral" },
} as const;

function billingViewOf(snapshot: object): Omit<ReleaseView, "events"> | null {
  const billing = (snapshot as { erpBilling?: unknown }).erpBilling;
  if (typeof billing !== "object" || billing === null) return null;
  const { state } = billing as { state?: unknown };
  if (typeof state !== "string" || !Object.prototype.hasOwnProperty.call(BILLING, state)) return null;
  return BILLING[state as keyof typeof BILLING];
}

export function releaseViewOf(snapshot: unknown): ReleaseView | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const billingView = billingViewOf(snapshot);
  const release = "erpRelease" in snapshot ? (snapshot as { erpRelease: unknown }).erpRelease : null;
  const { state, events } = typeof release === "object" && release !== null ? (release as { state?: unknown; events?: unknown }) : { state: undefined, events: undefined };
  if (!isState(state)) return billingView === null ? null : { ...billingView, events: [] };
  const lines: string[] = [];
  if (Array.isArray(events)) {
    for (const raw of events as unknown[]) {
      if (typeof raw !== "object" || raw === null) continue;
      const event = raw as { code?: unknown; label?: unknown; state?: unknown };
      if (typeof event.code !== "number" || !isState(event.state)) continue;
      const name = typeof event.label === "string" && event.label !== "" ? event.label : `evento ${event.code}`;
      lines.push(`${name}: ${VIEWS[event.state].label.toLowerCase()}`);
    }
  }
  return { ...(billingView ?? VIEWS[state]), events: lines };
}
