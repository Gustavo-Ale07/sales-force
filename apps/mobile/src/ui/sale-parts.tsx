import { StyleSheet, Text, View } from "react-native";
import { formatBrl } from "../lib/money";
import type { SalesRow } from "../offline/sales";
import { saleBadge, type BadgeTone } from "../offline/sales-status";
import { colors, spacing } from "../theme";

const TONE_COLOR: Record<BadgeTone, string> = { neutral: colors.textMuted, info: colors.navy, ok: colors.ok, warning: colors.warning, danger: colors.red };

export function SaleBadgeView({ status, remoteId }: { status: SalesRow["draft"]["status"]; remoteId: string | null }) {
  const badge = saleBadge({ status, remoteId });
  return (
    <View style={[styles.badge, { borderColor: TONE_COLOR[badge.tone] }]}>
      <Text style={[styles.badgeText, { color: TONE_COLOR[badge.tone] }]}>{badge.label}</Text>
    </View>
  );
}

export function describeSaleValue(value: SalesRow["value"]): string {
  if (value.amount === null) return "Sem valor";
  return formatBrl(value.amount) ?? value.amount;
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: "700" },
});
