/**
 * ERP release (liberação) of a sent order, read from the last server snapshot of the order (`erpRelease`). Display only:
 * the server decides; this never computes a state. "Aguardando liberação" is the NORMAL state of a sent order, so its
 * text is calm. The snapshot is untyped JSON, so every field is checked.
 */
export type ReleaseTone = "warning" | "success" | "danger";

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

export function releaseViewOf(snapshot: unknown): ReleaseView | null {
  if (typeof snapshot !== "object" || snapshot === null || !("erpRelease" in snapshot)) return null;
  const release = (snapshot as { erpRelease: unknown }).erpRelease;
  if (typeof release !== "object" || release === null) return null;
  const { state, events } = release as { state?: unknown; events?: unknown };
  if (!isState(state)) return null;
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
  return { ...VIEWS[state], events: lines };
}
