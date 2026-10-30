import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { sellableNegotiationTypes, topLabel, topOptions } from "../data/order-header";
import type { Carrier, OrderEntryConfiguration } from "../data/ports";
import { colors, spacing } from "../theme";

export interface OrderHeaderOptionsProps {
  readonly sales: OrderEntryConfiguration["sales"];
  /** The order's current TOP; `null` = none chosen, the server applies the default order TOP (D-A). */
  readonly topCode: number | null;
  readonly negotiationTypeCode: number | null;
  readonly onTopChange: (code: number) => void;
  readonly onNegotiationChange: (code: number) => void;
  /** Optional carrier (D-C). `null` list = still loading; empty = nothing to choose from (offline with no stored list). */
  readonly carriers: readonly Carrier[] | null;
  readonly carrierCode: number | null;
  readonly onCarrierChange: (code: number | null) => void;
}

/**
 * "Opções do pedido": the TOP (Pedido or Cotação, D-A) and the negotiation type (D-B: only the sellable ones). A group
 * with nothing to choose is not drawn. What is eligible is decided by the server; this is only the picker.
 */
export function OrderHeaderOptions({ sales, topCode, negotiationTypeCode, onTopChange, onNegotiationChange, carriers, carrierCode, onCarrierChange }: OrderHeaderOptionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const tops = topOptions(sales.orderTops);
  const negotiations = sellableNegotiationTypes(sales.negotiationTypes);
  const currentTop = topCode ?? sales.orderTops.defaultTopCode;
  const currentNegotiationHidden = negotiationTypeCode !== null && !negotiations.some((type) => type.code === negotiationTypeCode);
  const currentCarrier = carrierCode === null ? null : (carriers?.find((carrier) => carrier.code === carrierCode)?.name ?? `Transportadora ${carrierCode}`);
  return (
    <View style={styles.box} accessibilityLabel="Opções do pedido">
      <Text style={styles.title}>Opções do pedido</Text>
      {tops.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.caption}>Tipo de operação</Text>
          <View style={styles.chips}>
            {tops.map((option) => {
              const selected = option.code === currentTop;
              return (
                <Pressable
                  key={option.code}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => onTopChange(option.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Operação ${option.label}`}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      {negotiations.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.caption}>Tipo de negociação</Text>
          <View style={styles.chips}>
            {negotiations.map((type) => {
              const selected = type.code === negotiationTypeCode;
              return (
                <Pressable
                  key={type.code}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => onNegotiationChange(type.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Negociação ${type.label}`}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>{type.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {currentNegotiationHidden && (
            <Text style={styles.warning}>O tipo de negociação deste pedido não está mais disponível para venda. Escolha outro antes de salvar.</Text>
          )}
        </View>
      )}
      <View style={styles.group}>
        <Text style={styles.caption}>Transportadora (opcional)</Text>
        <Pressable
          style={styles.chip}
          onPress={() => setPickerOpen(true)}
          disabled={carriers === null || (carriers.length === 0 && carrierCode === null)}
          accessibilityRole="button"
          accessibilityLabel="Escolher transportadora"
        >
          <Text style={styles.chipText}>{currentCarrier ?? "Nenhuma"}</Text>
        </Pressable>
        {carriers !== null && carriers.length === 0 && carrierCode === null && (
          <Text style={styles.hint}>A lista de transportadoras não está disponível agora. Conecte-se para escolher uma.</Text>
        )}
      </View>
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Transportadora</Text>
            <ScrollView>
              {[{ code: null, name: "Nenhuma" }, ...(carriers ?? [])].map((carrier) => (
                <Pressable
                  key={carrier.code ?? "none"}
                  style={styles.option}
                  onPress={() => {
                    onCarrierChange(carrier.code);
                    setPickerOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Transportadora ${carrier.name}`}
                  accessibilityState={{ selected: carrier.code === carrierCode }}
                >
                  <Text style={[styles.chipText, carrier.code === carrierCode && styles.optionActive]}>{carrier.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.chip} onPress={() => setPickerOpen(false)} accessibilityRole="button" accessibilityLabel="Fechar">
              <Text style={styles.chipText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {tops.length > 0 && currentTop !== null && <Text style={styles.hint}>{`Operação atual: ${topLabel(currentTop, sales.orderTops)}.`}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { margin: spacing.md, padding: spacing.md, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  title: { fontSize: 14, fontWeight: "700", color: colors.text },
  group: { gap: spacing.xs },
  caption: { fontSize: 12, color: colors.textMuted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  chipTextActive: { color: colors.onNavy },
  warning: { fontSize: 12, color: colors.warning },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "70%", backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  option: { minHeight: 44, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.border },
  optionActive: { color: colors.navy, fontWeight: "800" },
  hint: { fontSize: 12, color: colors.textMuted },
});
