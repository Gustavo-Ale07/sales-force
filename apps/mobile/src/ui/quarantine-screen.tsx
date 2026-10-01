import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QuarantinedDraftDetail, QuarantinedDraftRecord } from "@salesforce/mobile-db";
import type { LocalOrdersPort } from "../offline/local-orders";
import { QUARANTINE_INTRO, QUARANTINE_TITLE, describeQuarantineReason } from "../offline/quarantine";
import { colors, spacing } from "../theme";
import { formatDateTime } from "./sync-status";

export interface QuarantineScreenProps {
  readonly localOrders: LocalOrdersPort;
  readonly onBack: () => void;
  /** A retained order was discarded: counters must be recomputed. */
  readonly onChanged: () => void;
}

type Loaded<T> = { readonly status: "loading" } | { readonly status: "error" } | { readonly status: "ready"; readonly value: T };

const itemsText = (count: number) => `${count} ${count === 1 ? "item" : "itens"}`;

/**
 * "Pedidos antigos retidos": orders created before the dataset check (or under another dataset). They are never sent and
 * never converted: the seller can read them and, when the server cannot have seen them, discard them from this device.
 * Deliberately no resend / convert / continue action exists here.
 */
export function QuarantineScreen({ localOrders, onBack, onChanged }: QuarantineScreenProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [list, setList] = useState<Loaded<QuarantinedDraftRecord[]>>({ status: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let current = true;
    localOrders
      .listQuarantined()
      .then((value) => current && setList({ status: "ready", value }))
      .catch(() => current && setList({ status: "error" }));
    return () => {
      current = false;
    };
  }, [localOrders, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);

  if (openId !== null) {
    return (
      <QuarantineDetail
        localOrders={localOrders}
        localId={openId}
        onBack={() => setOpenId(null)}
        onDiscarded={() => {
          setOpenId(null);
          reload();
          onChanged();
        }}
        onRefused={reload}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.bar}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar">
          <Text style={styles.backText}>‹ Voltar</Text>
        </Pressable>
      </View>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">{QUARANTINE_TITLE}</Text>
        <Text style={styles.intro}>{QUARANTINE_INTRO}</Text>
      </View>
      {list.status === "loading" && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.navy} />
          <Text style={styles.muted}>Carregando pedidos retidos...</Text>
        </View>
      )}
      {list.status === "error" && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>Não foi possível ler os pedidos retidos deste aparelho.</Text>
          <Pressable style={styles.retryTarget} onPress={reload} accessibilityRole="button" accessibilityLabel="Tentar novamente">
            <Text style={styles.retry}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}
      {list.status === "ready" && (
        <FlatList
          data={list.value}
          keyExtractor={(entry) => entry.draft.localId}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>Nenhum pedido retido neste aparelho.</Text>}
          renderItem={({ item: entry }) => (
            <Pressable
              style={styles.card}
              onPress={() => setOpenId(entry.draft.localId)}
              accessibilityRole="button"
              accessibilityLabel={`Ver pedido retido de ${entry.draft.customerName}`}
            >
              <Text style={styles.customer}>{entry.draft.customerName}</Text>
              <Text style={styles.meta}>{`Criado em ${formatDateTime(entry.draft.createdAt)}`}</Text>
              <Text style={styles.meta}>{itemsText(entry.draft.itemCount)}</Text>
              <Text style={styles.reason}>{describeQuarantineReason(entry.reason)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function QuarantineDetail({
  localOrders,
  localId,
  onBack,
  onDiscarded,
  onRefused,
}: {
  readonly localOrders: LocalOrdersPort;
  readonly localId: string;
  readonly onBack: () => void;
  readonly onDiscarded: () => void;
  readonly onRefused: () => void;
}) {
  const [detail, setDetail] = useState<Loaded<QuarantinedDraftDetail | null>>({ status: "loading" });

  useEffect(() => {
    let current = true;
    localOrders
      .openQuarantined(localId)
      .then((value) => current && setDetail({ status: "ready", value }))
      .catch(() => current && setDetail({ status: "error" }));
    return () => {
      current = false;
    };
  }, [localOrders, localId]);

  function confirmDiscard() {
    Alert.alert(
      "Descartar pedido?",
      "Este pedido será removido deste aparelho e não será enviado ao Force. Esta ação não pode ser desfeita.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Descartar",
          style: "destructive",
          onPress: () =>
            void (async () => {
              try {
                await localOrders.discardQuarantined(localId);
              } catch {
                Alert.alert("Não foi possível descartar", "Este pedido pode já ter chegado ao Force e não pode ser descartado por aqui.");
                onRefused();
                return;
              }
              onDiscarded();
            })(),
        },
      ],
    );
  }

  const back = (
    <View style={styles.bar}>
      <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar para pedidos retidos">
        <Text style={styles.backText}>‹ Pedidos retidos</Text>
      </Pressable>
    </View>
  );

  if (detail.status === "loading") {
    return (
      <View style={styles.flex}>
        {back}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.navy} />
          <Text style={styles.muted}>Carregando pedido...</Text>
        </View>
      </View>
    );
  }
  if (detail.status === "error" || detail.value === null) {
    return (
      <View style={styles.flex}>
        {back}
        <Text style={styles.empty}>Este pedido não está mais retido neste aparelho.</Text>
      </View>
    );
  }

  const { record, items } = detail.value;
  const { draft } = record;
  return (
    <View style={styles.flex}>
      {back}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.customer}>{draft.customerName}</Text>
          <Text style={styles.meta}>{`Cliente ${draft.customerCode}`}</Text>
          <Text style={styles.meta}>{`Criado em ${formatDateTime(draft.createdAt)}`}</Text>
          <Text style={styles.meta}>{itemsText(draft.itemCount)}</Text>
          <Text style={styles.reason}>{describeQuarantineReason(record.reason)}</Text>
          {draft.notes !== null && draft.notes !== "" && <Text style={styles.notes}>{`Observações: ${draft.notes}`}</Text>}
        </View>
        <View style={styles.card}>
          <Text style={styles.section}>{`Itens (${items.length})`}</Text>
          {items.map((item) => (
            <View key={item.position} style={styles.item} accessibilityLabel={`Item ${item.description}`}>
              <Text style={styles.itemName}>{item.description}</Text>
              <Text style={styles.meta}>{`${item.quantity} ${item.unit}`}</Text>
            </View>
          ))}
        </View>
        {record.canDiscard ? (
          <Pressable style={styles.danger} onPress={confirmDiscard} accessibilityRole="button" accessibilityLabel="Descartar pedido retido">
            <Text style={styles.dangerText}>Descartar</Text>
          </Pressable>
        ) : (
          <Text style={styles.meta}>Este pedido pode já ter chegado ao Force e não pode ser descartado por aqui.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  bar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  back: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  backText: { fontSize: 16, fontWeight: "700", color: colors.navy },
  header: { paddingHorizontal: spacing.lg, gap: spacing.xs, paddingBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.navy },
  intro: { fontSize: 14, color: colors.textMuted },
  listContent: { padding: spacing.lg, gap: spacing.sm },
  content: { padding: spacing.lg, gap: spacing.md },
  centered: { alignItems: "center", gap: spacing.xs, marginTop: spacing.xl },
  muted: { fontSize: 14, color: colors.textMuted },
  empty: { textAlign: "center", color: colors.text, fontSize: 16, fontWeight: "700", marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  notice: { backgroundColor: colors.errorBackground, borderRadius: 8, padding: spacing.lg, gap: spacing.sm, marginHorizontal: spacing.lg },
  noticeText: { color: colors.text, fontSize: 14 },
  retryTarget: { minHeight: 44, justifyContent: "center" },
  retry: { color: colors.red, fontWeight: "700", fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs, minHeight: 44 },
  customer: { fontSize: 17, fontWeight: "800", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  reason: { fontSize: 13, color: colors.warning, fontWeight: "600" },
  notes: { fontSize: 14, color: colors.text },
  section: { fontSize: 15, fontWeight: "800", color: colors.navy },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 },
  itemName: { fontSize: 15, fontWeight: "600", color: colors.text },
  danger: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.red, alignItems: "center", justifyContent: "center" },
  dangerText: { color: colors.red, fontSize: 15, fontWeight: "700" },
});
