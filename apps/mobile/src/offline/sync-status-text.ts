import { SYNC_FAILURE_TEXT, type SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";

export type SyncTone = "ok" | "pending" | "busy" | "offline" | "error";

export interface SyncStatusText {
  readonly text: string;
  readonly tone: SyncTone;
}

/** How long after a sync the chip keeps saying "Atualizado agora". */
export const JUST_NOW_MS = 60_000;

/**
 * The ONE verification behind both "Situação" and "Conexão": what the device knows about internet, the Force server and Sankhya.
 * Situação and Conexão are derived from it, so they can never contradict each other.
 */
interface Health {
  readonly internet: "ok" | "down" | "unknown";
  readonly server: "ok" | "down" | "unchecked";
  readonly sankhyaDown: boolean;
}

function healthOf(status: SyncStatus, connectivity: ConnectivityState): Health {
  const noInternet = connectivity === "offline" || status.failure === "no_internet" || (status.phase === "offline" && status.failure == null);
  if (noInternet) return { internet: "down", server: "unchecked", sankhyaDown: false };
  const internet = connectivity === "online" ? "ok" : "unknown";
  if (status.failure === "server_unavailable") return { internet, server: "down", sankhyaDown: false };
  return { internet, server: "ok", sankhyaDown: status.failure === "sankhya_unavailable" };
}

const clock = (iso: string): string | null => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** From this age on the data is highlighted (amber). The device never syncs by itself because of it. */
export const STALE_AFTER_MS = 24 * 3_600_000;

/** Short label for the compact header status. Same precedence as `describeSyncStatus`. */
export function describeSyncChip(status: SyncStatus, connectivity: ConnectivityState, now: number = Date.now()): SyncStatusText {
  if (status.phase === "syncing") return { text: "Sincronizando…", tone: "busy" };
  if (status.phase === "auth_required" || status.phase === "error") return { text: "Falhou. Tentar de novo", tone: "error" };
  const health = healthOf(status, connectivity);
  // "Offline" means exactly: no internet or the Force server not answering.
  if (health.internet === "down" || health.server === "down") {
    return { text: status.pending > 0 ? `Offline · ${status.pending}` : "Offline", tone: "offline" };
  }
  if (health.sankhyaDown) return { text: "Sankhya indisponível", tone: "pending" };
  if (status.needsAttention > 0) return { text: "Atenção", tone: "pending" };
  if (status.pending > 0) return { text: `Pendências (${status.pending})`, tone: "pending" };
  if (status.lastSyncedAt === null) return { text: "Online", tone: "ok" };
  const age = now - new Date(status.lastSyncedAt).getTime();
  return age >= 0 && age < JUST_NOW_MS ? { text: "Atualizado agora", tone: "ok" } : { text: "Sincronizado", tone: "ok" };
}

/** The indicator wording. Technical errors never reach the seller; each state says what happens to their work. */
export function describeSyncStatus(status: SyncStatus, connectivity: ConnectivityState): SyncStatusText {
  if (status.phase === "syncing") return { text: "Sincronizando…", tone: "busy" };
  if (status.phase === "auth_required") return { text: "Sessão expirada — entre novamente para sincronizar", tone: "error" };
  if (status.phase === "error") return { text: "Erro ao sincronizar", tone: "error" };
  const health = healthOf(status, connectivity);
  if (health.internet === "down") return { text: SYNC_FAILURE_TEXT.no_internet, tone: "offline" };
  if (health.server === "down") return { text: SYNC_FAILURE_TEXT.server_unavailable, tone: "offline" };
  if (health.sankhyaDown) return { text: SYNC_FAILURE_TEXT.sankhya_unavailable, tone: "pending" };
  if (status.needsAttention > 0) {
    return { text: `${status.needsAttention === 1 ? "1 pedido precisa" : `${status.needsAttention} pedidos precisam`} de atenção`, tone: "error" };
  }
  if (status.pending > 0) return { text: `Alterações pendentes (${status.pending})`, tone: "pending" };
  const time = status.lastSyncedAt === null ? null : clock(status.lastSyncedAt);
  return { text: time === null ? "Sincronizado" : `Sincronizado às ${time}`, tone: "ok" };
}

export type SyncIndicatorColor = "green" | "yellow" | "red";

export interface SyncIndicator {
  readonly color: SyncIndicatorColor;
  /** State in WORDS (accessibility label, never color alone). */
  readonly label: string;
  /** The arrows spin; they keep `color`. */
  readonly spinning: boolean;
}

/**
 * Line color of the two arrows per state (the site copies the same table). Drawn straight on the navy header
 * (#001369), so each one clears 3:1 for graphics there: green 9.3, yellow 9.5, red 6.0 (covered in a test).
 */
export const SYNC_INDICATOR_HEX: Record<SyncIndicatorColor, string> = { green: "#4ADE80", yellow: "#FBBF24", red: "#F87171" };

/**
 * Header sync dot (PAR-1: the site uses the SAME table). First matching row wins:
 *   state (precedence)                                         -> color  -> label
 *   1 last sync failed (phase error / session expired)         -> red    -> "Erro na última sincronização"
 *   2 order(s) needing correction (needsAttention > 0)         -> red    -> "Pedido precisa de correção"
 *   3 no internet / Force server not answering                 -> yellow -> "Sem conexão"
 *   4 Sankhya unavailable (partial sync)                       -> yellow -> "Servidor instável, tentando de novo"
 *   5 orders waiting to be sent (pending > 0)                  -> yellow -> "Pedidos aguardando envio"
 *   6 last successful sync older than 24 h                     -> yellow -> "Dados desatualizados"
 *   7 otherwise                                                -> green  -> "Sincronizado"
 * While syncing the arrows spin and the color is the one of rows 2-7 (row 1 is the previous attempt, so ignored); the label starts with "Sincronizando".
 */
export function describeSyncIndicator(status: SyncStatus, connectivity: ConnectivityState, now: number = Date.now()): SyncIndicator {
  const syncing = status.phase === "syncing";
  const base = ((): { color: SyncIndicatorColor; label: string } => {
    if (!syncing && (status.phase === "error" || status.phase === "auth_required")) return { color: "red", label: "Erro na última sincronização" };
    if (status.needsAttention > 0) return { color: "red", label: "Pedido precisa de correção" };
    const health = healthOf(status, connectivity);
    if (health.internet === "down" || health.server === "down") return { color: "yellow", label: "Sem conexão" };
    if (health.sankhyaDown) return { color: "yellow", label: "Servidor instável, tentando de novo" };
    if (status.pending > 0) return { color: "yellow", label: "Pedidos aguardando envio" };
    const at = status.lastSyncedAt === null ? Number.NaN : new Date(status.lastSyncedAt).getTime();
    if (!Number.isNaN(at) && now - at >= STALE_AFTER_MS) return { color: "yellow", label: "Dados desatualizados" };
    return { color: "green", label: "Sincronizado" };
  })();
  if (!syncing) return { ...base, spinning: false };
  return { color: base.color, label: base.color === "green" ? "Sincronizando" : `Sincronizando. ${base.label}`, spinning: true };
}
