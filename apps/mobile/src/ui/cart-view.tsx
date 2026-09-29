import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  discountProblemMessages,
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
}

function CartLine({ line, preview, onQuantityChange, onDiscountChange, onRemove }: CartLineProps) {
  const amounts = lineAmountsOf(preview);
  const noPrice = line.price.state === "none";
  return (
    <View style={styles.line} accessible>
      <View style={styles.lineHeader}>
        <View style={styles.lineHeaderText}>
          <Text style={styles.name}>{line.description}</Text>
          <Text style={styles.meta}>{`Código ${line.productCode} · ${line.unit} · ${describeListPrice(line.price)}`}</Text>
        </View>
        <Pressable
          onPress={() => onRemove(line.key)}
          accessibilityRole="button"
          accessibilityLabel={`Remover ${line.description} do carrinho`}
          hitSlop={8}
        >
          <Text style={styles.remove}>Remover</Text>
        </Pressable>
      </View>

      <View style={styles.fields}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Quantidade</Text>
          <TextInput
            style={styles.input}
            value={line.quantityText}
            onChangeText={(text) => onQuantityChange(line.key, text)}
            keyboardType="decimal-pad"
            accessibilityLabel={`Quantidade de ${line.description}`}
          />
          {preview.quantityProblem !== undefined && (
            <Text style={styles.error}>{quantityProblemMessages[preview.quantityProblem]}</Text>
          )}
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Desconto %</Text>
          <TextInput
            style={[styles.input, noPrice && styles.inputDisabled]}
            value={line.discountText}
            onChangeText={(text) => onDiscountChange(line.key, text)}
            keyboardType="decimal-pad"
            editable={!noPrice}
            placeholder={noPrice ? "—" : "0"}
            accessibilityLabel={`Desconto de ${line.description}`}
          />
          {preview.discountProblem !== undefined && (
            <Text style={styles.error}>{discountProblemMessages[preview.discountProblem]}</Text>
          )}
        </View>
      </View>

      <View style={styles.amounts}>
        <Text style={styles.amountText}>{`Subtotal ${money(amounts.subtotal)}`}</Text>
        {amounts.discountAmount !== null && amounts.discountAmount !== "0" && amounts.discountAmount !== "0.00" && (
          <Text style={styles.amountText}>{`Desconto -${money(amounts.discountAmount)}`}</Text>
        )}
        <Text style={styles.lineTotal}>{money(amounts.lineTotal)}</Text>
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
}

/**
 * Step 3 of the new-order flow: cart lines with quantity/discount editing, per-line amounts and the order
 * financial summary. Every number shown comes from `packages/domain` via `order-draft.ts` previews — this
 * component only renders text and forwards edits.
 */
export function CartView({ lines, preview, onQuantityChange, onDiscountChange, onRemove }: CartViewProps) {
  if (lines.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Nenhum item no carrinho. Adicione produtos no catálogo.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {lines.map((line, index) => (
        <CartLine
          key={line.key}
          line={line}
          preview={preview.lines[index] ?? { key: line.key, item: null }}
          onQuantityChange={onQuantityChange}
          onDiscountChange={onDiscountChange}
          onRemove={onRemove}
        />
      ))}

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
          <Text style={styles.summaryTotalLabel}>Total estimado</Text>
          <Text style={styles.summaryTotalValue}>{money(preview.totals.estimatedTotal)}</Text>
        </View>
        {preview.totals.isPartial && (
          <Text style={styles.partialNotice}>
            {`Pedido parcial: ${preview.totals.unpricedLineCount} item(ns) sem preço não entram no total.`}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  line: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm },
  lineHeaderText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  remove: { color: colors.red, fontWeight: "700", fontSize: 13 },
  fields: { flexDirection: "row", gap: spacing.md },
  field: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  input: {
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
  amounts: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.md },
  amountText: { fontSize: 12, color: colors.textMuted },
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
