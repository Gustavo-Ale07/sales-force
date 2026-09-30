import { Pressable, StyleSheet, Text } from "react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import { describeSyncStatus, type SyncTone } from "../offline/sync-status-text";
import { colors, spacing } from "../theme";

const TONE_COLOR: Record<SyncTone, string> = {
  ok: colors.ok,
  pending: colors.warning,
  busy: colors.textMuted,
  offline: colors.warning,
  error: colors.red,
};

/** One line under the header: what happened to the seller's work. Tapping it retries when there is something to retry. */
export function SyncIndicator({ status, connectivity, onRetry }: { status: SyncStatus; connectivity: ConnectivityState; onRetry: () => void }) {
  const { text, tone } = describeSyncStatus(status, connectivity);
  return (
    <Pressable
      style={styles.bar}
      onPress={onRetry}
      disabled={status.phase === "syncing"}
      accessibilityRole="button"
      accessibilityLabel={`Sincronização: ${text}`}
    >
      <Text style={[styles.text, { color: TONE_COLOR[tone] }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  text: { fontSize: 13, fontWeight: "600" },
});
