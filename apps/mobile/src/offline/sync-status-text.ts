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

/** The "Conexão" line, e.g. "Internet: ok · Servidor: sem resposta". */
export function describeConnection(status: SyncStatus, connectivity: ConnectivityState): string {
  const health = healthOf(status, connectivity);
  const internet = health.internet === "ok" ? "ok" : health.internet === "down" ? "sem sinal" : "verificando";
  const server = health.server === "ok" ? "ok" : health.server === "down" ? "sem resposta" : "não verificado";
  return `Internet: ${internet} · Servidor: ${server}${health.sankhyaDown ? " · Sankhya: indisponível" : ""}`;
}

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
  if (status.pending > 0) return { text: `↑ Alterações pendentes (${status.pending})`, tone: "pending" };
  const time = status.lastSyncedAt === null ? null : clock(status.lastSyncedAt);
  return { text: time === null ? "✓ Sincronizado" : `✓ Sincronizado às ${time}`, tone: "ok" };
}
