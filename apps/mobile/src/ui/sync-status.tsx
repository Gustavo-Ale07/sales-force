import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useInsets } from "./use-insets";
import type { SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import { describeSyncChip, describeSyncStatus, type SyncTone } from "../offline/sync-status-text";
import { colors, spacing } from "../theme";

const TONE_COLOR: Record<SyncTone, string> = {
  ok: colors.ok,
  pending: colors.warning,
  busy: colors.textMuted,
  offline: colors.warning,
  error: colors.red,
};

/** dd/mm/aaaa HH:mm (pt-BR) without depending on Intl support in the JS engine. */
export function formatDateTime(iso: string | null): string {
  if (iso === null) return "Ainda não sincronizado";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Ainda não sincronizado";
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export interface SyncViewProps {
  readonly status: SyncStatus;
  readonly connectivity: ConnectivityState;
  /** Runs the real sync manager (manual). */
  readonly onSyncNow: () => void;
}

/** Compact header status: a dot and one short word. Tapping opens the details. */
export function SyncStatusChip({ status, connectivity, onPress }: Pick<SyncViewProps, "status" | "connectivity"> & { onPress: () => void }) {
  const { text, tone } = describeSyncChip(status, connectivity);
  return (
    <Pressable style={styles.chip} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Status de sincronização: ${text}`}>
      <View style={[styles.dot, { backgroundColor: TONE_COLOR[tone] }]} />
      <Text style={styles.chipText}>{text}</Text>
    </Pressable>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor !== undefined && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

/** Status, last sync, pending count and the manual action. Shared by the header sheet and Perfil. */
export function SyncPanel({ status, connectivity, onSyncNow }: SyncViewProps) {
  const { text, tone } = describeSyncStatus(status, connectivity);
  const syncing = status.phase === "syncing";
  const offline = connectivity === "offline";
  return (
    <View style={styles.panel}>
      <Row label="Situação" value={text} valueColor={TONE_COLOR[tone]} />
      <Row label="Conexão" value={offline ? "Sem conexão" : connectivity === "online" ? "Online" : "Verificando"} />
      <Row label="Última sincronização" value={formatDateTime(status.lastSyncedAt)} />
      <Row label="Alterações pendentes" value={String(status.pending)} />
      {status.needsAttention > 0 && <Row label="Pedidos que precisam de atenção" value={String(status.needsAttention)} valueColor={colors.red} />}
      {status.phase === "error" && <Text style={styles.errorNote}>A última tentativa falhou. Suas alterações continuam salvas neste aparelho.</Text>}
      {status.phase === "auth_required" && <Text style={styles.errorNote}>Sua sessão expirou. Saia e entre novamente para sincronizar.</Text>}
      <Pressable
        style={[styles.syncButton, (syncing || offline) && styles.syncButtonDisabled]}
        onPress={onSyncNow}
        disabled={syncing || offline}
        accessibilityRole="button"
        accessibilityLabel="Sincronizar agora"
        accessibilityState={{ disabled: syncing || offline }}
      >
        <Text style={styles.syncButtonText}>{syncing ? "Sincronizando..." : "Sincronizar agora"}</Text>
      </Pressable>
      {offline && <Text style={styles.hint}>Sem conexão: a sincronização acontece quando a rede voltar.</Text>}
    </View>
  );
}

/** Basic sync details as a bottom sheet. */
export function SyncDetailsSheet({ visible, onClose, ...view }: SyncViewProps & { visible: boolean; onClose: () => void }) {
  const insets = useInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar detalhes de sincronização" />
      <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>Sincronização</Text>
        <SyncPanel {...view} />
      </View>
    </Modal>
  );
}

/** Chip + its details sheet, for the app header. */
export function HeaderSyncStatus(view: SyncViewProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SyncStatusChip status={view.status} connectivity={view.connectivity} onPress={() => setOpen(true)} />
      <SyncDetailsSheet visible={open} onClose={() => setOpen(false)} {...view} onSyncNow={view.onSyncNow} />
    </>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: spacing.md, minHeight: 32 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.text },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  panel: { gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs },
  rowLabel: { fontSize: 14, color: colors.textMuted, flexShrink: 1, minWidth: 100 },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.text, flexShrink: 1, textAlign: "right" },
  errorNote: { fontSize: 13, color: colors.text, backgroundColor: colors.errorBackground, borderRadius: 6, padding: spacing.sm },
  syncButton: { backgroundColor: colors.navy, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  syncButtonDisabled: { opacity: 0.5 },
  syncButtonText: { color: colors.onNavy, fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: "center" },
});
