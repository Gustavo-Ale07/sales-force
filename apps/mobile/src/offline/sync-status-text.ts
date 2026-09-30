import type { SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";

export type SyncTone = "ok" | "pending" | "busy" | "offline" | "error";

export interface SyncStatusText {
  readonly text: string;
  readonly tone: SyncTone;
}

/** Short label for the compact header status. Same precedence as `describeSyncStatus`. */
export function describeSyncChip(status: SyncStatus, connectivity: ConnectivityState): SyncStatusText {
  if (status.phase === "syncing") return { text: "Sincronizando", tone: "busy" };
  if (status.phase === "auth_required" || status.phase === "error") return { text: "Erro", tone: "error" };
  if (connectivity === "offline" || status.phase === "offline") {
    return { text: status.pending > 0 ? `Offline · ${status.pending}` : "Offline", tone: "offline" };
  }
  if (status.needsAttention > 0) return { text: "Erro", tone: "error" };
  if (status.pending > 0) return { text: `Pendências (${status.pending})`, tone: "pending" };
  return status.lastSyncedAt !== null ? { text: "Sincronizado", tone: "ok" } : { text: "Online", tone: "ok" };
}

/** The indicator wording. Technical errors never reach the seller; each state says what happens to their work. */
export function describeSyncStatus(status: SyncStatus, connectivity: ConnectivityState): SyncStatusText {
  if (status.phase === "syncing") return { text: "Sincronizando...", tone: "busy" };
  if (status.phase === "auth_required") return { text: "Sessão expirada — entre novamente para sincronizar", tone: "error" };
  if (status.phase === "error") return { text: "Erro ao sincronizar", tone: "error" };
  if (connectivity === "offline" || status.phase === "offline") {
    return { text: "Sem conexão — alterações salvas neste dispositivo", tone: "offline" };
  }
  if (status.needsAttention > 0) {
    return { text: `${status.needsAttention === 1 ? "1 pedido precisa" : `${status.needsAttention} pedidos precisam`} de atenção`, tone: "error" };
  }
  if (status.pending > 0) return { text: `↑ Alterações pendentes (${status.pending})`, tone: "pending" };
  return { text: "✓ Sincronizado", tone: "ok" };
}
