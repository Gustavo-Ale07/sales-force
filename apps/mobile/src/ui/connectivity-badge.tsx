import { StyleSheet, Text, View } from "react-native";
import type { ConnectivityState } from "../connectivity/connectivity";
import { colors, spacing } from "../theme";

export const CONNECTIVITY_LABEL: Record<ConnectivityState, string> = {
  online: "Online",
  offline: "Sem conexão",
  unknown: "Verificando conexão",
};

/** Small "online / offline" indicator for the header. Colour is never the only signal: the text says it. */
export function ConnectivityBadge({ state }: { state: ConnectivityState }) {
  const dotColor = state === "online" ? colors.ok : state === "offline" ? colors.red : colors.textMuted;
  return (
    <View
      style={styles.badge}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Conexão: ${CONNECTIVITY_LABEL[state]}`}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.text}>{CONNECTIVITY_LABEL[state]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12, fontWeight: "600", color: colors.text },
});
