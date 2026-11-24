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

/** Data older than this is "Dados desatualizados" (yellow). */
export const SYNC_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isDataStale(dataAsOf: string | null | undefined, now: number): boolean {
  if (!dataAsOf) return false;
  const at = Date.parse(dataAsOf);
  return Number.isFinite(at) && now - at > SYNC_STALE_AFTER_MS;
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
