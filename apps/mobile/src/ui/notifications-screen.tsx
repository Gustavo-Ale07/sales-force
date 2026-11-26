import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { LocalNotification } from "@salesforce/mobile-db";
import type { NotificationsPort } from "../offline/tasks-service";
import { colors, radius, spacing } from "../theme";
import { BackLink } from "./back-link";
import { formatTaskDateTime } from "./task-dates";

export interface NotificationsScreenProps {
  readonly notifications: NotificationsPort;
  readonly onBack: () => void;
  /** Opens the record a notification is about (order, customer registration, task). */
  readonly onOpenTarget: (target: { readonly refType: LocalNotification["refType"]; readonly refId: string }) => void;
}

/** M-16: central de notificações. Read from the device cache; the refresh runs when the screen opens. */
export function NotificationsScreen({ notifications, onBack, onOpenTarget }: NotificationsScreenProps) {
  const [items, setItems] = useState<LocalNotification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const load = useCallback(async () => setItems(await notifications.list()), [notifications]);
  useEffect(() => {
    void notifications.list().then(setItems);
    void notifications.refresh().then(load);
  }, [notifications, load]);

  const visible = unreadOnly ? items.filter((item) => item.readAt === null) : items;
  return (
    <View style={styles.screen}>
      <BackLink label="Voltar" onPress={onBack} accessibilityLabel="Voltar" />
      <View style={styles.titleRow}>
        <Text style={styles.title}>Notificações</Text>
        <Pressable
          style={styles.secondary}
          onPress={() => void notifications.markRead().then(load)}
          accessibilityRole="button"
          accessibilityLabel="Marcar todas como lidas"
        >
          <Text style={styles.secondaryText}>Marcar todas</Text>
        </Pressable>
      </View>
      <View style={styles.filters}>
        {([[false, "Todas"], [true, "Não lidas"]] as const).map(([value, label]) => (
          <Pressable key={label} style={[styles.chip, unreadOnly === value && styles.chipOn]} onPress={() => setUnreadOnly(value)} accessibilityRole="button" accessibilityState={{ selected: unreadOnly === value }}>
            <Text style={[styles.chipText, unreadOnly === value && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma notificação.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.body}`}
            onPress={() => {
              if (item.readAt === null) void notifications.markRead([item.id]).then(load);
              onOpenTarget({ refType: item.refType, refId: item.refId });
            }}
          >
            <Text style={[styles.cardTitle, item.readAt === null && styles.unread]}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.meta}>{formatTaskDateTime(item.createdAt)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.md, gap: spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, fontWeight: "700", color: colors.navy },
  filters: { flexDirection: "row", gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 14, color: colors.text },
  chipTextOn: { color: colors.onNavy, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
  cardTitle: { fontSize: 16, color: colors.text },
  unread: { fontWeight: "700" },
  body: { fontSize: 14, color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  empty: { fontSize: 14, color: colors.textMuted, padding: spacing.lg },
  secondary: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: "center", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy },
  secondaryText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
});
