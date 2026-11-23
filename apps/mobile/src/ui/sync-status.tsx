import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useInsets } from "./use-insets";
import type { SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import { describeConnection, describeSyncAge, describeSyncChip, describeSyncStatus, type SyncTone } from "../offline/sync-status-text";
import { colors, control, spacing } from "../theme";
import { useAppModal } from "./app-modal";
import { Icon } from "./icons";
import { RefreshArrows } from "./refresh-arrows";
import { SyncIcon } from "./sync-icon";

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
  /** Retained ("Pedidos antigos retidos") orders on this device; the link shows only when there are some and a handler is given. */
  readonly quarantinedCount?: number;
  readonly onOpenQuarantine?: () => void;
  /** Clock for the age line (tests); defaults to the current time. */
  readonly now?: number;
}

/**
 * Icon-only header indicator (no text): white circular refresh arrows on the navy header with a small corner dot whose SHAPE says the state
 * (never color alone): up to date = green circle with check, syncing = the arrows spin (still when the system reduces motion), waiting orders =
 * amber pill with the count, offline = hollow ring with a dash, failure = red rounded square with "!".
 * The spoken label carries the full wording. 44 x 44 touch target.
 */
export function SyncStatusChip({ status, connectivity, onPress }: Pick<SyncViewProps, "status" | "connectivity"> & { onPress: () => void }) {
  const { text, tone } = describeSyncChip(status, connectivity);
  const syncing = status.phase === "syncing";
  const color = TONE_COLOR[tone];
  const waiting = status.pending > 0 && (tone === "pending" || tone === "offline");
  const markKind = syncing ? "busy" : waiting ? "count" : tone;
  return (
    <Pressable style={styles.chip} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Status de sincronização: ${text}`}>
      <View style={styles.glyph}>
        <RefreshArrows testID={syncing ? "sync-icon-spinner" : "sync-arrows"} color={colors.onNavy} size={24} spinning={syncing} />
        {!syncing && (
          <View
            testID={`sync-mark-${markKind}`}
            style={[
              styles.mark,
              waiting ? styles.markPill : tone === "error" ? styles.markSquare : tone === "offline" ? styles.markHollow : null,
              tone === "offline" && !waiting ? { borderColor: color } : { backgroundColor: color },
            ]}
          >
            {waiting ? (
              <Text style={styles.markCount}>{status.pending > 9 ? "9+" : String(status.pending)}</Text>
            ) : tone === "ok" ? (
              <Icon name="check" color={colors.onNavy} size={9} />
            ) : tone === "offline" ? (
              <View style={[styles.markDash, { backgroundColor: color }]} />
            ) : (
              <Icon name="alert" color={colors.onNavy} size={9} />
            )}
          </View>
        )}
        {syncing && <View testID="sync-mark-busy" style={styles.markBusy} />}
      </View>
    </Pressable>
  );
}

/** "Última sincronização às HH:MM" (the title of the header popup). */
export function describeLastSyncTitle(lastSyncedAt: string | null): string {
  if (lastSyncedAt === null) return "Ainda não sincronizado";
  const date = new Date(lastSyncedAt);
  if (Number.isNaN(date.getTime())) return "Ainda não sincronizado";
  const two = (value: number) => String(value).padStart(2, "0");
  return `Última sincronização às ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor !== undefined && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const MOBILITY_LABEL = { products: "Produtos", tops: "Tipos de operação", negotiationTypes: "Condições de pagamento" } as const;

/** Status, last sync, pending count and the manual action. Shared by the header sheet and Perfil. */
export function SyncPanel({ status, connectivity, onSyncNow, quarantinedCount = 0, onOpenQuarantine, now }: SyncViewProps) {
  const { text, tone } = describeSyncStatus(status, connectivity);
  const age = describeSyncAge(status.lastSyncedAt, now);
  const syncing = status.phase === "syncing";
  const offline = connectivity === "offline";
  return (
    <View style={styles.panel}>
      <Row label="Situação" value={text} valueColor={TONE_COLOR[tone]} />
      <Row label="Conexão" value={describeConnection(status, connectivity)} />
      {syncing && status.progress != null && (
        <Text style={styles.progress}>{status.progress.percent === null ? status.progress.label : `${status.progress.label} (${status.progress.percent}%)`}</Text>
      )}
      {!syncing && status.failure === "sankhya_unavailable" && (status.failedSteps?.length ?? 0) > 0 && (
        <Text style={styles.hint}>{`Não atualizado: ${(status.failedSteps ?? []).join(", ")}`}</Text>
      )}
      {!syncing && (status.mobility ?? []).some((m) => m.keptPrevious) && (
        <Text style={styles.errorNote}>Configuração de mobilidade incompleta — avise o TI; mantida a base anterior</Text>
      )}
      {!syncing && (status.mobility ?? []).filter((m) => !m.keptPrevious).map((m) => (
        <Text key={m.kind} style={styles.progress}>{`${MOBILITY_LABEL[m.kind]}: ${m.visible} ${m.visible === 1 ? "visível" : "visíveis"}, ${m.hidden} ${m.hidden === 1 ? "oculto" : "ocultos"}`}</Text>
      ))}
      <Row label="Última sincronização" value={formatDateTime(status.lastSyncedAt)} />
      {age !== null && <Row label="Dados atualizados" value={age.text} valueColor={age.stale ? colors.warning : colors.text} />}
      <Row label="Alterações pendentes" value={String(status.pending)} />
      {status.needsAttention > 0 && <Row label="Pedidos que precisam de atenção" value={String(status.needsAttention)} valueColor={colors.red} />}
      {(status.attention ?? []).map((item) => (
        <View key={item.localId} style={styles.attentionItem}>
          <Text style={styles.attentionCustomer}>{item.customerName}</Text>
          <Text style={styles.attentionReason}>{item.reason}</Text>
        </View>
      ))}
      {quarantinedCount > 0 && onOpenQuarantine !== undefined && (
        <View style={styles.quarantine}>
          <Text style={styles.quarantineText}>Pedidos antigos retidos não são enviados ao Force. Você pode consultá-los ou descartá-los.</Text>
          <Pressable style={styles.quarantineLink} onPress={onOpenQuarantine} accessibilityRole="button" accessibilityLabel="Ver pedidos antigos retidos">
            <Text style={styles.quarantineLinkText}>{`Pedidos antigos retidos (${quarantinedCount})`}</Text>
            <Icon name="arrow" color={colors.text} size={18} />
          </Pressable>
        </View>
      )}
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
        {syncing && <SyncIcon tone="busy" syncing color={colors.onNavy} size={16} />}
        <Text style={styles.syncButtonText}>{syncing ? "Sincronizando…" : "Sincronizar agora"}</Text>
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
  const modal = useAppModal();
  /** The standard popup: last sync time + "Sincronizar agora"; on failure the reason in seller language, "Ver detalhes" and "Tentar de novo". */
  const showPopup = () => {
    const failed = view.status.phase === "error" || view.status.phase === "auth_required" || view.status.phase === "offline" || view.status.failure != null;
    const { text } = describeSyncStatus(view.status, view.connectivity);
    modal.show({
      variant: failed ? "error" : "info",
      title: describeLastSyncTitle(view.status.lastSyncedAt),
      ...(failed ? { message: text } : view.status.pending > 0 ? { message: `Alterações pendentes: ${view.status.pending}` } : {}),
      buttons: [
        { label: failed ? "Tentar de novo" : "Sincronizar agora", role: "primary", onPress: view.onSyncNow },
        ...(failed || view.status.needsAttention > 0 || (view.quarantinedCount ?? 0) > 0 ? [{ label: "Ver detalhes", role: "secondary" as const, onPress: () => setOpen(true) }] : []),
        { label: "Fechar", role: "cancel" as const },
      ],
    });
  };
  return (
    <>
      <SyncStatusChip status={view.status} connectivity={view.connectivity} onPress={showPopup} />
      <SyncDetailsSheet
        visible={open}
        onClose={() => setOpen(false)}
        {...view}
        onSyncNow={view.onSyncNow}
        {...(view.onOpenQuarantine === undefined
          ? {}
          : {
              onOpenQuarantine: () => {
                setOpen(false);
                view.onOpenQuarantine?.();
              },
            })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  chip: { minWidth: control.height, minHeight: control.height, alignItems: "center", justifyContent: "center" },
  glyph: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  // Small state dot on the corner of the white arrows; its SHAPE (circle / pill / rounded square / hollow ring) says the state, not only the color.
  mark: { position: "absolute", right: -3, bottom: -3, width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.navy, alignItems: "center", justifyContent: "center" },
  markPill: { width: undefined, minWidth: 16, paddingHorizontal: 2, borderRadius: 8 },
  markSquare: { borderRadius: 3 },
  markHollow: { backgroundColor: colors.navy, borderColor: colors.warning },
  markBusy: { position: "absolute", width: 0, height: 0 },
  markCount: { color: colors.onNavy, fontSize: 9, fontWeight: "800" },
  markDash: { width: 6, height: 2, borderRadius: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  panel: { gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs },
  rowLabel: { fontSize: 14, color: colors.textMuted, flexShrink: 1, minWidth: 100 },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.text, flexShrink: 1, textAlign: "right" },
  errorNote: { fontSize: 13, color: colors.text, backgroundColor: colors.errorBackground, borderRadius: 6, padding: spacing.sm },
  syncButton: { backgroundColor: colors.navy, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: spacing.sm, flexDirection: "row", gap: spacing.sm },
  syncButtonDisabled: { opacity: 0.5 },
  syncButtonText: { color: colors.onNavy, fontSize: 15, fontWeight: "700" },
  quarantine: { gap: spacing.xs, borderRadius: 6, backgroundColor: colors.errorBackground, padding: spacing.sm },
  quarantineText: { fontSize: 13, color: colors.text },
  quarantineLink: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 },
  quarantineLinkText: { fontSize: 14, fontWeight: "700", color: colors.navy },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: "center" },
  progress: { fontSize: 13, color: colors.textMuted },
  attentionItem: { gap: 2, borderRadius: 6, backgroundColor: colors.errorBackground, padding: spacing.sm },
  attentionCustomer: { fontSize: 14, fontWeight: "700", color: colors.text },
  attentionReason: { fontSize: 13, color: colors.text },
});
