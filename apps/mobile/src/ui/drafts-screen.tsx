import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { DraftRecord, SyncStatus } from "@salesforce/mobile-db";
import { formatBrl } from "../lib/money";
import { describeDraftStatus, type LocalOrdersPort } from "../offline/local-orders";
import { colors, spacing } from "../theme";

export interface DraftsScreenProps {
  readonly localOrders: LocalOrdersPort;
  /** Changes whenever the sync state changes, so the list follows deliveries without polling. */
  readonly syncStatus: SyncStatus;
  readonly onOpen: (localId: string) => void;
}

function priceText(value: string | null): string {
  return value === null ? "Sem preço" : (formatBrl(value) ?? value);
}

/** Orders saved on this device, with what happened to each one. Price reviews and conflicts are resolved here, never silently. */
export function DraftsScreen({ localOrders, syncStatus, onOpen }: DraftsScreenProps) {
  const [drafts, setDrafts] = useState<DraftRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setDrafts(await localOrders.list());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [localOrders]);

  useEffect(() => {
    let active = true;
    localOrders
      .list()
      .then((found) => {
        if (!active) return;
        setDrafts(found);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [localOrders, syncStatus.phase, syncStatus.pending, syncStatus.needsAttention, syncStatus.lastSyncedAt]);

  async function act(work: () => Promise<void>) {
    try {
      await work();
    } catch {
      Alert.alert("Não foi possível concluir", "Tente novamente quando houver conexão.");
    }
    await load();
  }

  function confirmDiscard(draft: DraftRecord) {
    Alert.alert("Descartar rascunho", "Ele será removido deste aparelho. Deseja continuar?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Descartar", style: "destructive", onPress: () => void act(() => localOrders.discard(draft.localId)) },
    ]);
  }

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Não foi possível ler os pedidos deste aparelho.</Text>
        <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.buttonText}>Tentar novamente</Text>
        </Pressable>
      </View>
    );
  }
  if (drafts === null) return <View style={styles.center} />;
  if (drafts.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Nenhum pedido salvo neste aparelho.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={drafts}
      keyExtractor={(draft) => draft.localId}
      contentContainerStyle={styles.list}
      renderItem={({ item: draft }) => (
        <View style={styles.card}>
          <Pressable onPress={() => onOpen(draft.localId)} accessibilityRole="button" accessibilityLabel={`Abrir pedido de ${draft.customerName}`}>
            <Text style={styles.customer} numberOfLines={1}>
              {draft.customerName}
            </Text>
            <Text style={styles.meta}>
              {`${draft.itemCount} ${draft.itemCount === 1 ? "item" : "itens"}`}
              {draft.remoteDraftNumber !== null ? ` · Pedido nº ${draft.remoteDraftNumber}` : ""}
              {draft.estimatedTotal !== null ? ` · ${formatBrl(draft.estimatedTotal) ?? ""}` : ""}
            </Text>
            <Text style={[styles.status, (draft.status === "sync_error" || draft.status === "conflict") && styles.statusAlert]}>
              {describeDraftStatus(draft.status)}
            </Text>
            {draft.lastError !== null && draft.status !== "synced" && <Text style={styles.error}>{draft.lastError}</Text>}
          </Pressable>

          {draft.priceReview !== null && draft.priceReview.length > 0 && (
            <View style={styles.review}>
              <Text style={styles.reviewTitle}>Preços alterados desde a última atualização</Text>
              {draft.priceReview.map((entry) => (
                <Text key={entry.productCode} style={styles.reviewLine}>
                  {`${entry.description}: ${priceText(entry.cachedUnitPrice)} → ${priceText(entry.serverUnitPrice)}`}
                </Text>
              ))}
              <Pressable
                style={styles.button}
                onPress={() => void act(() => localOrders.acknowledgePriceReview(draft.localId))}
                accessibilityRole="button"
                accessibilityLabel="Aceitar novos preços"
              >
                <Text style={styles.buttonText}>Aceitar novos preços</Text>
              </Pressable>
            </View>
          )}

          {draft.status === "conflict" && (
            <View style={styles.review}>
              <Text style={styles.reviewTitle}>Este pedido foi alterado em outro lugar. Nada foi sobrescrito.</Text>
              <View style={styles.row}>
                <Pressable
                  style={styles.button}
                  onPress={() => void act(() => localOrders.resolveConflict(draft.localId, "keep_local"))}
                  accessibilityRole="button"
                  accessibilityLabel="Manter minha versão"
                >
                  <Text style={styles.buttonText}>Manter minha versão</Text>
                </Pressable>
                <Pressable
                  style={styles.buttonSecondary}
                  onPress={() => void act(() => localOrders.resolveConflict(draft.localId, "use_server"))}
                  accessibilityRole="button"
                  accessibilityLabel="Usar a versão do servidor"
                >
                  <Text style={styles.buttonSecondaryText}>Usar a do servidor</Text>
                </Pressable>
              </View>
            </View>
          )}

          {draft.remoteId === null && (
            <Pressable onPress={() => confirmDiscard(draft)} accessibilityRole="button" accessibilityLabel="Descartar rascunho">
              <Text style={styles.discard}>Descartar</Text>
            </Pressable>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  message: { fontSize: 15, color: colors.textMuted, textAlign: "center" },
  list: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  customer: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  status: { fontSize: 13, fontWeight: "700", color: colors.navy },
  statusAlert: { color: colors.red },
  error: { fontSize: 13, color: colors.text },
  review: { backgroundColor: colors.errorBackground, borderRadius: 6, padding: spacing.sm, gap: spacing.xs },
  reviewTitle: { fontSize: 13, fontWeight: "700", color: colors.text },
  reviewLine: { fontSize: 13, color: colors.text },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  button: { backgroundColor: colors.navy, borderRadius: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignSelf: "flex-start" },
  buttonText: { color: colors.onNavy, fontSize: 14, fontWeight: "700" },
  buttonSecondary: { borderWidth: 1, borderColor: colors.navy, borderRadius: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  buttonSecondaryText: { color: colors.navy, fontSize: 14, fontWeight: "700" },
  discard: { color: colors.red, fontSize: 14, fontWeight: "600" },
});
