import { Pressable, StyleSheet, Text, View } from "react-native";
import { sellableNegotiationTypes, topLabel, topOptions } from "../data/order-header";
import type { OrderEntryConfiguration } from "../data/ports";
import { colors, spacing } from "../theme";

export interface OrderHeaderOptionsProps {
  readonly sales: OrderEntryConfiguration["sales"];
  /** The order's current TOP; `null` = none chosen, the server applies the default order TOP (D-A). */
  readonly topCode: number | null;
  readonly negotiationTypeCode: number | null;
  readonly onTopChange: (code: number) => void;
  readonly onNegotiationChange: (code: number) => void;
}

/**
 * "Opções do pedido": the TOP (Pedido or Cotação, D-A) and the negotiation type (D-B: only the sellable ones). A group
 * with nothing to choose is not drawn. What is eligible is decided by the server; this is only the picker.
 */
export function OrderHeaderOptions({ sales, topCode, negotiationTypeCode, onTopChange, onNegotiationChange }: OrderHeaderOptionsProps) {
  const tops = topOptions(sales.orderTops);
  const negotiations = sellableNegotiationTypes(sales.negotiationTypes);
  const currentTop = topCode ?? sales.orderTops.defaultTopCode;
  const currentNegotiationHidden = negotiationTypeCode !== null && !negotiations.some((type) => type.code === negotiationTypeCode);
  if (tops.length === 0 && negotiations.length === 0) return null;
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
  hint: { fontSize: 12, color: colors.textMuted },
});
