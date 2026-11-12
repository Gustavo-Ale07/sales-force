import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import type { OrderHeaderIssueCode } from "@salesforce/domain";
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
  /** Mandatory carrier. `null` list = still loading; empty = nothing to choose from (offline with no stored list). */
  readonly carriers: readonly Carrier[] | null;
  readonly carrierCode: number | null;
  readonly onCarrierChange: (code: number) => void;
  /** Mandatory freight. `null` = not chosen. */
  readonly freightType: FreightType | null;
  readonly onFreightChange: (value: FreightType) => void;
  /** Header fields still missing (shared domain rule); highlighted once `showMissing`. */
  readonly missing?: readonly OrderHeaderIssueCode[];
  readonly showMissing?: boolean;
  /** Vertical offset of each field inside the scroll content, so the screen can scroll to the first empty one. */
  readonly onFieldOffset?: (code: OrderHeaderIssueCode, y: number) => void;
}

type FreightType = "CIF" | "FOB" | "SEM_FRETE";

const FREIGHT_OPTIONS: readonly { readonly value: FreightType; readonly label: string }[] = [
  { value: "CIF", label: "CIF" },
  { value: "FOB", label: "FOB" },
  { value: "SEM_FRETE", label: "Sem frete" },
];

/**
 * "Opções do pedido": the TOP (Pedido or Orçamento, D-A) and the negotiation type (D-B: only the sellable ones). A group
 * with nothing to choose is not drawn. What is eligible is decided by the server; this is only the picker.
 */
export function OrderHeaderOptions({ sales, topCode, negotiationTypeCode, onTopChange, onNegotiationChange, carriers, carrierCode, onCarrierChange, freightType, onFreightChange, missing = [], showMissing = false, onFieldOffset }: OrderHeaderOptionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const boxY = useRef(0);
  const isMissing = (code: OrderHeaderIssueCode) => showMissing && missing.includes(code);
  const groupProps = (code: OrderHeaderIssueCode) => ({
    style: [styles.group, isMissing(code) && styles.groupMissing],
    onLayout: (event: LayoutChangeEvent) => onFieldOffset?.(code, boxY.current + event.nativeEvent.layout.y),
  });
  const caption = (label: string, code: OrderHeaderIssueCode) => (
    <Text style={[styles.caption, isMissing(code) && styles.captionMissing]}>
      {label}
      <Text style={styles.required}> *</Text>
      {isMissing(code) ? " — obrigatório" : ""}
    </Text>
  );
  const tops = topOptions(sales.orderTops);
  const negotiations = sellableNegotiationTypes(sales.negotiationTypes);
  const currentTop = topCode ?? sales.orderTops.defaultTopCode;
  const currentNegotiationHidden = negotiationTypeCode !== null && !negotiations.some((type) => type.code === negotiationTypeCode);
  const currentCarrier = carrierCode === null ? null : (carriers?.find((carrier) => carrier.code === carrierCode)?.name ?? `Transportadora ${carrierCode}`);
  return (
    <View
      style={styles.box}
      accessibilityLabel="Opções do pedido"
      onLayout={(event) => {
        boxY.current = event.nativeEvent.layout.y;
      }}
    >
      <Text style={styles.title}>Opções do pedido</Text>
      {tops.length > 0 && (
        <View {...groupProps("missing_top")}>
          {caption("Tipo de operação", "missing_top")}
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
        <View {...groupProps("missing_negotiation_type")}>
          {caption("Tipo de negociação", "missing_negotiation_type")}
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
      <View {...groupProps("missing_freight_type")}>
        {caption("Frete", "missing_freight_type")}
        <View style={styles.chips}>
          {FREIGHT_OPTIONS.map((option) => {
            const selected = option.value === freightType;
            return (
              <Pressable
                key={option.value}
                style={[styles.chip, selected && styles.chipActive]}
                onPress={() => onFreightChange(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Frete ${option.label}`}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>CIF: o frete é por conta de quem vende. FOB: por conta do cliente.</Text>
      </View>
      <View {...groupProps("missing_carrier")}>
        {caption("Transportadora", "missing_carrier")}
        <Pressable
          style={styles.chip}
          onPress={() => setPickerOpen(true)}
          disabled={carriers === null || (carriers.length === 0 && carrierCode === null)}
          accessibilityRole="button"
          accessibilityLabel="Escolher transportadora"
        >
          <Text style={styles.chipText}>{currentCarrier ?? "Escolher transportadora"}</Text>
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
              {(carriers ?? []).map((carrier) => (
                <Pressable
                  key={carrier.code}
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
  groupMissing: { borderLeftWidth: 3, borderLeftColor: colors.warning, paddingLeft: spacing.sm },
  captionMissing: { color: colors.warning, fontWeight: "700" },
  required: { color: colors.warning, fontWeight: "700" },
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
