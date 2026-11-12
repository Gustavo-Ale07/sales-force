import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  decrementLineQuantity,
  discountProblemMessages,
  incrementLineQuantity,
  lineAmountsOf,
  quantityProblemMessages,
  type DraftPreview,
  type EditorLine,
  type LinePreview,
} from "../data/order-draft";
import { describeListPrice, formatBrl } from "../lib/money";
import { colors, spacing } from "../theme";

function money(value: string | null): string {
  if (value === null) return "—";
  return formatBrl(value) ?? "—";
}

interface CartLineProps {
  readonly line: EditorLine;
  readonly preview: LinePreview;
  readonly onQuantityChange: (key: string, text: string) => void;
  readonly onDiscountChange: (key: string, text: string) => void;
  readonly onRemove: (key: string) => void;
  /** Selection mode (mobile's phone-appropriate stand-in for the desktop's checkboxes + toolbar, DISC-1/MOB-4). */
  readonly selectionMode: boolean;
  readonly selected: boolean;
  readonly onToggleSelect: (key: string) => void;
  /** Long-pressing any line enters selection mode and selects it in one gesture. */
  readonly onLongPress: (key: string) => void;
}

function CartLine({ line, preview, onQuantityChange, onDiscountChange, onRemove, selectionMode, selected, onToggleSelect, onLongPress }: CartLineProps) {
  const amounts = lineAmountsOf(preview);
  const noPrice = line.price.state === "none";
  const decrement = decrementLineQuantity(line);
  // At the minimum step the "−" is inert: taking an item out of the cart is the explicit "Remover" button.
  const canDecrement = decrement?.kind === "set";
  const hasDiscount = amounts.discountAmount !== null && amounts.discountAmount !== "0" && amounts.discountAmount !== "0.00";
  return (
    <View style={[styles.line, selected && styles.lineSelected]} accessible>
      <Pressable
        style={styles.lineHeader}
        onPress={() => selectionMode && onToggleSelect(line.key)}
        onLongPress={() => onLongPress(line.key)}
        accessibilityRole={selectionMode ? "checkbox" : undefined}
        accessibilityState={selectionMode ? { checked: selected } : undefined}
        accessibilityLabel={selectionMode ? `Selecionar ${line.description}` : undefined}
      >
        {selectionMode && (
          <View style={[styles.checkbox, selected && styles.checkboxChecked]}>{selected && <Text style={styles.checkboxMark}>✓</Text>}</View>
        )}
        <View style={styles.lineHeaderText}>
          <Text style={styles.name} numberOfLines={2}>
            {line.description}
          </Text>
          <Text style={styles.meta}>{`Cód. ${line.productCode} · ${line.unit}`}</Text>
          <Text style={styles.unitPrice}>{noPrice ? "Sem preço" : `${describeListPrice(line.price)} por ${line.unit}`}</Text>
        </View>
        {!selectionMode && (
          <Pressable
            style={styles.removeButton}
            onPress={() => onRemove(line.key)}
            accessibilityRole="button"
            accessibilityLabel={`Remover ${line.description} do carrinho`}
            hitSlop={8}
          >
            <Text style={styles.remove}>Remover</Text>
          </Pressable>
        )}
      </Pressable>

      <View style={styles.fields}>
        <View style={styles.fieldWide}>
          <Text style={styles.fieldLabel}>Quantidade</Text>
          <View style={styles.stepperRow}>
            <Pressable
              style={[styles.stepButton, !canDecrement && styles.stepButtonDisabled]}
              onPress={() => decrement?.kind === "set" && onQuantityChange(line.key, decrement.quantityText)}
              disabled={!canDecrement}
              accessibilityRole="button"
              accessibilityLabel={`Diminuir quantidade de ${line.description}`}
            >
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <TextInput
              style={[styles.input, styles.quantityInput]}
              value={line.quantityText}
              onChangeText={(text) => onQuantityChange(line.key, text)}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel={`Quantidade de ${line.description}`}
            />
            <Pressable
              style={styles.stepButton}
              onPress={() => onQuantityChange(line.key, incrementLineQuantity(line).quantityText)}
              accessibilityRole="button"
              accessibilityLabel={`Aumentar quantidade de ${line.description}`}
            >
              <Text style={styles.stepText}>+</Text>
            </Pressable>
            <Text style={styles.unitBeside}>{line.unit}</Text>
          </View>
          {preview.quantityProblem !== undefined && (
            <Text style={styles.error}>{quantityProblemMessages[preview.quantityProblem]}</Text>
          )}
        </View>
        <View style={styles.fieldNarrow}>
          <Text style={styles.fieldLabel}>Desconto</Text>
          <View style={styles.percentRow}>
            <TextInput
              style={[styles.input, styles.percentInput, noPrice && styles.inputDisabled]}
              value={line.discountText}
              onChangeText={(text) => onDiscountChange(line.key, text)}
              keyboardType="decimal-pad"
              editable={!noPrice}
              placeholder={noPrice ? "—" : "0"}
              selectTextOnFocus
              accessibilityLabel={`Desconto de ${line.description}`}
            />
            <Text style={styles.percentSign}>%</Text>
          </View>
          {preview.discountProblem !== undefined && (
            <Text style={styles.error}>{discountProblemMessages[preview.discountProblem]}</Text>
          )}
        </View>
      </View>

      <View style={styles.amounts}>
        {hasDiscount ? <Text style={styles.discountAmount}>{`− ${money(amounts.discountAmount)}`}</Text> : <View />}
        <Text style={styles.lineTotal} accessibilityLabel={`Subtotal ${money(amounts.lineTotal)}`}>
          {`Subtotal ${money(amounts.lineTotal)}`}
        </Text>
      </View>
    </View>
  );
}

export interface CartViewProps {
  readonly lines: readonly EditorLine[];
  readonly preview: DraftPreview;
  readonly onQuantityChange: (key: string, text: string) => void;
  readonly onDiscountChange: (key: string, text: string) => void;
  readonly onRemove: (key: string) => void;
  /** Selection mode: choosing a subset of lines for group discount (long-press or the "Selecionar itens" toggle). */
  readonly selectionMode: boolean;
  readonly selected: ReadonlySet<string>;
  readonly onToggleSelect: (key: string) => void;
  readonly onLongPressLine: (key: string) => void;
}

/**
 * Step 3 of the new-order flow: cart lines with quantity/discount editing, per-line amounts and the order
 * financial summary. Every number shown comes from `packages/domain` via `order-draft.ts` previews — this
 * component only renders text and forwards edits.
 */
export function CartView({ lines, preview, onQuantityChange, onDiscountChange, onRemove, selectionMode, selected, onToggleSelect, onLongPressLine }: CartViewProps) {
  if (lines.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Nenhum item no carrinho. Adicione produtos no catálogo.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!selectionMode && (
        <Text style={styles.selectionHint}>Toque e segure um item para selecionar vários e aplicar um desconto só a eles.</Text>
      )}
      {lines.map((line, index) => (
        <CartLine
          key={line.key}
          line={line}
          preview={preview.lines[index] ?? { key: line.key, item: null }}
          onQuantityChange={onQuantityChange}
          onDiscountChange={onDiscountChange}
          onRemove={onRemove}
          selectionMode={selectionMode}
          selected={selected.has(line.key)}
          onToggleSelect={onToggleSelect}
          onLongPress={onLongPressLine}
        />
      ))}

      <OrderTotals preview={preview} />
    </ScrollView>
  );
}

/** Totals block (items, discounts, IPI, grand total): same numbers as the cart, reused by the order summary. */
export function OrderTotals({ preview }: { readonly preview: DraftPreview }) {
  return (
  <View style={styles.summary}>
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>Total de itens</Text>
      <Text style={styles.summaryValue}>{money(preview.discounts.listTotal)}</Text>
    </View>
    {preview.discounts.discountTotal !== "0" && preview.discounts.discountTotal !== "0.00" && (
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>{`Descontos (${preview.discounts.discountedLineCount} item(ns))`}</Text>
        <Text style={styles.summaryValue}>{`-${money(preview.discounts.discountTotal)}`}</Text>
      </View>
    )}
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>Total sem IPI</Text>
      <Text style={styles.summaryValue}>{money(preview.totals.estimatedTotal)}</Text>
    </View>
    {preview.totals.isPartial && (
      <Text style={styles.partialNotice}>
        {`Pedido parcial: ${preview.totals.unpricedLineCount} item(ns) sem preço não entram no total.`}
      </Text>
    )}
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>IPI estimado</Text>
      <Text style={styles.summaryValue}>{money(preview.ipi.ipiEstimated)}</Text>
    </View>
    <View style={styles.summaryRow}>
      <Text style={styles.summaryTotalLabel}>{preview.ipi.isPartial ? "Total parcial com IPI" : "Total com IPI"}</Text>
      <Text style={styles.summaryTotalValue}>{money(preview.ipi.grandTotalEstimated)}</Text>
    </View>
    {preview.ipi.unavailableLineCount > 0 && (
      <Text style={styles.partialNotice}>{`IPI não disponível em ${preview.ipi.unavailableLineCount} item(ns).`}</Text>
    )}
    {preview.ipi.exemptLineCount > 0 && (
      <Text style={styles.partialNotice}>{`IPI isento/não informado em ${preview.ipi.exemptLineCount} item(ns).`}</Text>
    )}
    {preview.ipi.tariffLineCount > 0 && (
      <Text style={styles.partialNotice}>{`IPI por pauta — não estimado em ${preview.ipi.tariffLineCount} item(ns).`}</Text>
    )}
  </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  selectionHint: { fontSize: 11, color: colors.textMuted, fontStyle: "italic" },
  line: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lineSelected: { borderColor: colors.navy, borderWidth: 2 },
  lineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm },
  lineHeaderText: { flex: 1, gap: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { borderColor: colors.navy, backgroundColor: colors.navy },
  checkboxMark: { color: colors.onNavy, fontSize: 13, fontWeight: "800" },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  unitPrice: { fontSize: 13, color: colors.text, fontWeight: "600" },
  removeButton: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  remove: { color: colors.red, fontWeight: "700", fontSize: 13 },
  fields: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  fieldWide: { flex: 3, gap: 4 },
  fieldNarrow: { flex: 2, gap: 4 },
  fieldLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  stepButtonDisabled: { opacity: 0.35 },
  stepText: { fontSize: 22, fontWeight: "700", color: colors.navy, lineHeight: 26 },
  quantityInput: { flex: 1, minWidth: 44, textAlign: "center" },
  unitBeside: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  percentRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  percentInput: { flex: 1, minWidth: 48, textAlign: "right" },
  percentSign: { fontSize: 16, fontWeight: "700", color: colors.textMuted },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputDisabled: { color: colors.textMuted, backgroundColor: colors.border },
  error: { color: colors.red, fontSize: 11 },
  amounts: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  discountAmount: { fontSize: 13, color: colors.red, fontWeight: "700" },
  lineTotal: { fontSize: 16, fontWeight: "800", color: colors.navy },
  summary: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { fontSize: 13, color: colors.textMuted },
  summaryValue: { fontSize: 13, color: colors.text, fontWeight: "600" },
  summaryTotalLabel: { fontSize: 15, fontWeight: "800", color: colors.text, marginTop: spacing.xs },
  summaryTotalValue: { fontSize: 20, fontWeight: "800", color: colors.navy, marginTop: spacing.xs },
  partialNotice: { fontSize: 12, color: colors.warning, marginTop: spacing.xs },
});
