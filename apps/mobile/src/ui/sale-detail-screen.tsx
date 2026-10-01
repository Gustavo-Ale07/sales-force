import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DraftRecord } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import { lineAmountsOf, previewDraft, type EditorLine } from "../data/order-draft";
import { formatBrl } from "../lib/money";
import type { LocalOrdersPort } from "../offline/local-orders";
import { saleValue } from "../offline/sales";
import { saleActions, saleExplanation } from "../offline/sales-status";
import { colors, spacing } from "../theme";
import { SaleBadgeView, describeSaleValue } from "./sale-parts";
import { formatDateTime } from "./sync-status";

export interface SaleDetailScreenProps {
  readonly localId: string;
  readonly localOrders: LocalOrdersPort;
  readonly connectivity: ConnectivityState;
  readonly onBack: () => void;
  /** Something changed locally (deleted, resolved, price accepted): the list must reload. */
  readonly onChanged: () => void;
  readonly onContinue: (localId: string) => void;
  readonly onDuplicate: (localId: string) => void;
  readonly onSyncNow: () => void;
}

interface Loaded {
  readonly draft: DraftRecord;
  readonly lines: readonly EditorLine[];
}

function priceText(value: string | null): string {
  return value === null ? "Sem preço" : (formatBrl(value) ?? value);
}

function money(value: string | null): string {
  return value === null ? "Sem preço" : (formatBrl(value) ?? value);
}

/** Read-only view of one sale, with only the actions that are safe for its state. Explains what each state means in plain words. */
export function SaleDetailScreen({ localId, localOrders, connectivity, onBack, onChanged, onContinue, onDuplicate, onSyncNow }: SaleDetailScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [reloads, setReloads] = useState(0);
  const offline = connectivity === "offline";

  useEffect(() => {
    let current = true;
    localOrders
      .open(localId)
      .then((found) => {
        if (!current) return;
        if (found === null) setMissing(true);
        else setLoaded({ draft: found.draft, lines: found.lines });
      })
      .catch(() => current && setMissing(true));
    return () => {
      current = false;
    };
  }, [localOrders, localId, reloads]);

  const act = useCallback(
    async (work: () => Promise<void>, failure = "Tente novamente quando houver conexão.") => {
      try {
        await work();
      } catch {
        Alert.alert("Não foi possível concluir", failure);
      }
      onChanged();
      setReloads((n) => n + 1);
    },
    [onChanged],
  );

  if (missing) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Esta venda não está mais neste aparelho.</Text>
        <Pressable style={styles.secondary} onPress={onBack} accessibilityRole="button" accessibilityLabel="Voltar para Vendas">
          <Text style={styles.secondaryText}>Voltar para Vendas</Text>
        </Pressable>
      </View>
    );
  }
  if (loaded === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.navy} accessibilityLabel="Carregando venda" />
        <Text style={styles.message}>Carregando venda...</Text>
      </View>
    );
  }

  const { draft, lines } = loaded;
  const actions = saleActions(draft);
  const preview = previewDraft(lines);
  const value = saleValue(draft, lines);

  function confirmDelete() {
    Alert.alert(
      "Excluir rascunho?",
      "Este pedido será removido deste aparelho e não será enviado ao Force. Esta ação não pode ser desfeita.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () =>
            void (async () => {
              try {
                await localOrders.discard(draft.localId);
              } catch {
                Alert.alert("Não foi possível excluir", "Este pedido já foi enviado ao Force e não pode ser excluído por aqui.");
                onChanged();
                setReloads((n) => n + 1);
                return;
              }
              onChanged();
              onBack();
            })(),
        },
      ],
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.bar}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar para Vendas">
          <Text style={styles.backText}>‹ Vendas</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.customer}>{draft.customerName}</Text>
          <Text style={styles.meta}>{`Cliente ${draft.customerCode}`}</Text>
          <View style={styles.statusLine}>
            <SaleBadgeView status={draft.status} remoteId={draft.remoteId} />
            <Text style={styles.meta}>{draft.remoteDraftNumber !== null ? `Pedido nº ${draft.remoteDraftNumber}` : "Sem número ainda"}</Text>
          </View>
          <Text style={styles.explanation}>{saleExplanation(draft)}</Text>
          <Text style={styles.meta}>{`Criado em ${formatDateTime(draft.createdAt)}`}</Text>
          <Text style={styles.meta}>{`Última alteração ${formatDateTime(draft.updatedAt)}`}</Text>
          {draft.negotiationTypeCode !== null && <Text style={styles.meta}>{`Negociação (código): ${draft.negotiationTypeCode}`}</Text>}
          {draft.notes !== null && draft.notes !== "" && <Text style={styles.notes}>{`Observações: ${draft.notes}`}</Text>}
        </View>

        {draft.priceReview !== null && draft.priceReview.length > 0 && (
          <View style={styles.alert}>
            <Text style={styles.alertTitle}>Preços alterados desde a última atualização</Text>
            {draft.priceReview.map((entry) => (
              <Text key={entry.productCode} style={styles.alertLine}>{`${entry.description}: ${priceText(entry.cachedUnitPrice)} → ${priceText(entry.serverUnitPrice)}`}</Text>
            ))}
            <Pressable style={styles.primary} onPress={() => void act(() => localOrders.acknowledgePriceReview(draft.localId))} accessibilityRole="button" accessibilityLabel="Aceitar novos preços">
              <Text style={styles.primaryText}>Aceitar novos preços</Text>
            </Pressable>
          </View>
        )}

        {draft.status === "conflict" && (
          <View style={styles.alert}>
            <Text style={styles.alertTitle}>Este pedido foi alterado em outro lugar. Nada foi sobrescrito.</Text>
            {offline && <Text style={styles.alertLine}>Conecte-se à internet para escolher qual versão manter.</Text>}
            <View style={styles.row}>
              <Pressable
                style={[styles.primary, offline && styles.off]}
                disabled={offline}
                onPress={() => void act(() => localOrders.resolveConflict(draft.localId, "keep_local"))}
                accessibilityRole="button"
                accessibilityLabel="Manter minha versão"
                accessibilityState={{ disabled: offline }}
              >
                <Text style={styles.primaryText}>Manter minha versão</Text>
              </Pressable>
              <Pressable
                style={[styles.secondary, offline && styles.off]}
                disabled={offline}
                onPress={() => void act(() => localOrders.resolveConflict(draft.localId, "use_server"))}
                accessibilityRole="button"
                accessibilityLabel="Usar a versão do servidor"
                accessibilityState={{ disabled: offline }}
              >
                <Text style={styles.secondaryText}>Usar a do servidor</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.section}>{`Itens (${lines.length})`}</Text>
          {lines.map((line, index) => {
            const linePreview = preview.lines[index];
            const amounts = linePreview === undefined ? null : lineAmountsOf(linePreview);
            const price = line.price.state === "none" ? null : line.price.unitPrice;
            return (
              <View key={line.key} style={styles.item} accessibilityLabel={`Item ${line.description}`}>
                <Text style={styles.itemName}>{line.description}</Text>
                <Text style={styles.meta}>{`${line.quantityText} ${line.unit} × ${money(price)}${line.discountText !== "" && line.discountText !== "0" ? ` · desconto ${line.discountText}%` : ""}`}</Text>
                <Text style={styles.itemTotal}>{money(amounts?.lineTotal ?? null)}</Text>
              </View>
            );
          })}
          <View style={styles.totalLine}>
            <Text style={styles.totalLabel}>{draft.status === "synced" ? "Total" : "Valor estimado"}</Text>
            <Text style={styles.totalValue}>{describeSaleValue(value)}</Text>
          </View>
          {value.partial && value.amount !== null && <Text style={styles.partial}>Há itens sem preço: o valor é parcial.</Text>}
        </View>

        <View style={styles.actions}>
          {actions.continue && (
            <Pressable style={styles.primary} onPress={() => onContinue(draft.localId)} accessibilityRole="button" accessibilityLabel="Continuar pedido">
              <Text style={styles.primaryText}>Continuar pedido</Text>
            </Pressable>
          )}
          {actions.resend && (
            <>
              <Pressable style={[styles.secondary, offline && styles.off]} disabled={offline} onPress={onSyncNow} accessibilityRole="button" accessibilityLabel="Tentar enviar novamente" accessibilityState={{ disabled: offline }}>
                <Text style={styles.secondaryText}>Tentar enviar novamente</Text>
              </Pressable>
              {offline && <Text style={styles.meta}>Sem conexão. O envio acontece sozinho quando a internet voltar.</Text>}
            </>
          )}
          {actions.duplicate && (
            <Pressable style={styles.secondary} onPress={() => onDuplicate(draft.localId)} accessibilityRole="button" accessibilityLabel="Duplicar pedido">
              <Text style={styles.secondaryText}>Duplicar</Text>
            </Pressable>
          )}
          {actions.delete && (
            <Pressable style={styles.danger} onPress={confirmDelete} accessibilityRole="button" accessibilityLabel="Excluir pedido">
              <Text style={styles.dangerText}>Excluir</Text>
            </Pressable>
          )}
          {!actions.delete && draft.remoteId !== null && <Text style={styles.meta}>Pedidos já enviados ao Force não podem ser excluídos por aqui.</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background, position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md, position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.background },
  message: { fontSize: 15, color: colors.textMuted, textAlign: "center" },
  bar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  back: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  backText: { fontSize: 16, fontWeight: "700", color: colors.navy },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  customer: { fontSize: 20, fontWeight: "800", color: colors.text },
  statusLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  explanation: { fontSize: 14, color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  notes: { fontSize: 14, color: colors.text },
  section: { fontSize: 15, fontWeight: "800", color: colors.navy },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 },
  itemName: { fontSize: 15, fontWeight: "600", color: colors.text },
  itemTotal: { fontSize: 14, fontWeight: "700", color: colors.navy },
  totalLine: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  totalLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  totalValue: { fontSize: 16, fontWeight: "800", color: colors.navy },
  partial: { fontSize: 12, color: colors.warning },
  alert: { backgroundColor: colors.errorBackground, borderRadius: 8, padding: spacing.md, gap: spacing.sm },
  alertTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  alertLine: { fontSize: 13, color: colors.text },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  actions: { gap: spacing.sm },
  primary: { minHeight: 48, borderRadius: 8, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  primaryText: { color: colors.onNavy, fontSize: 15, fontWeight: "700" },
  secondary: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  secondaryText: { color: colors.navy, fontSize: 15, fontWeight: "700" },
  danger: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.red, alignItems: "center", justifyContent: "center" },
  dangerText: { color: colors.red, fontSize: 15, fontWeight: "700" },
  off: { opacity: 0.45 },
});
