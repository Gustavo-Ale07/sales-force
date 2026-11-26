/** Colour of the header sync dot. Same table as the app: ok -> green; pending, offline, stale, slow -> yellow; error -> red. */
export type SyncDotColor = "green" | "yellow" | "red";

export interface SyncIndicatorInput {
  /** Browser connectivity (`navigator.onLine`). */
  online: boolean;
  /** A refresh or a data fetch is running now. */
  syncing: boolean;
  /** The last refresh (or a data read) failed. */
  failed: boolean;
  /** Some order needs correction (status `rejected`). */
  needsCorrection: boolean;
  /** Some order waits to be sent (`queued`). */
  awaitingSend: boolean;
  /** Sankhya data older than the stale limit. */
  stale: boolean;
  /** A read is being retried or is slow. */
  retrying: boolean;
}

export interface SyncIndicatorView {
  color: SyncDotColor;
  /** Words for `aria-label`/`title`; never colour alone. */
  label: string;
  spinning: boolean;
}

/** Stroke colour of the header arrows per state; same hex as the app. Checked against the header navy in the unit test. */
export const SYNC_INDICATOR_HEX: Record<SyncDotColor, string> = { green: "#4ADE80", yellow: "#FBBF24", red: "#F87171" };

/** Data older than this is "Dados desatualizados" (yellow). */
export const SYNC_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isDataStale(dataAsOf: string | null | undefined, now: number): boolean {
  if (!dataAsOf) return false;
  const at = Date.parse(dataAsOf);
  return Number.isFinite(at) && now - at > SYNC_STALE_AFTER_MS;
}

export interface SyncSituationInput {
  online: boolean;
  syncing: boolean;
  failed: boolean;
  needsCorrection: boolean;
  /** How many orders need correction (1 when only the flag is known). */
  attention?: number;
  /** Orders waiting to be sent. */
  pending: number;
  /** Time of the last data read (ISO), when known. */
  dataAsOf: string | null;
}

/** The one-sentence "Situação" of the Perfil block: same wording and precedence as the app's `describeSyncStatus`. */
export function syncSituation(input: SyncSituationInput): { text: string; color: SyncDotColor } {
  if (input.syncing) return { text: "Sincronizando…", color: "yellow" };
  if (input.failed) return { text: "Erro ao sincronizar", color: "red" };
  if (!input.online) return { text: "Sem internet — alterações salvas neste aparelho", color: "yellow" };
  if (input.needsCorrection) {
    const count = Math.max(1, input.attention ?? 1);
    return { text: `${count === 1 ? "1 pedido precisa" : `${count} pedidos precisam`} de atenção`, color: "red" };
  }
  if (input.pending > 0) return { text: `Alterações pendentes (${input.pending})`, color: "yellow" };
  const at = input.dataAsOf ? new Date(input.dataAsOf) : null;
  if (at === null || Number.isNaN(at.getTime())) return { text: "Sincronizado", color: "green" };
  const two = (value: number) => String(value).padStart(2, "0");
  return { text: `Sincronizado às ${two(at.getHours())}:${two(at.getMinutes())}`, color: "green" };
}

/** dd/mm/aaaa HH:mm, as the app's "Última sincronização". */
export function formatLastSync(iso: string | null): string {
  if (iso === null) return "Ainda não sincronizado";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Ainda não sincronizado";
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** First matching row wins (same table as the app). While syncing, the "last sync failed" row is ignored and the colour is kept. */
export function syncIndicatorView(input: SyncIndicatorInput): SyncIndicatorView {
  const spinning = input.syncing;
  const pick = (): { color: SyncDotColor; text: string } => {
    if (input.failed && !spinning) return { color: "red", text: "Erro na última sincronização" };
    if (input.needsCorrection) return { color: "red", text: "Pedido precisa de correção" };
    if (!input.online) return { color: "yellow", text: "Sem conexão" };
    if (input.retrying) return { color: "yellow", text: "Servidor instável, tentando de novo" };
    if (input.awaitingSend) return { color: "yellow", text: "Pedidos aguardando envio" };
    if (input.stale) return { color: "yellow", text: "Dados desatualizados" };
    return { color: "green", text: "Sincronizado" };
  };
  const { color, text } = pick();
  const phrase = !spinning ? text : color === "green" ? "Sincronizando" : `Sincronizando. ${text}`;
  return { color, label: `Status de sincronização: ${phrase}`, spinning };
}
