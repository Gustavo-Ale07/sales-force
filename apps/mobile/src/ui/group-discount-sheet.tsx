import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  applyGroupDiscounts,
  discountProblemMessages,
  discountTextOf,
  groupKeyOf,
  groupOfLine,
  groupRowsOf,
  parseDiscountInput,
  type EditorLine,
  type LineGroup,
} from "../data/order-draft";
import type { ProductRepository } from "../data/ports";
import { colors, spacing } from "../theme";

export interface GroupDiscountSheetProps {
  readonly visible: boolean;
  readonly lines: readonly EditorLine[];
  readonly products: ProductRepository;
  /** Replaces the lines with the ones that carry the new per-group discounts. */
  readonly onApply: (lines: EditorLine[], applied: number) => void;
  readonly onClose: () => void;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const EMPTY_LOOKUP: ReadonlyMap<number, LineGroup> = new Map();

/**
 * Automatic catalog-group discount (MOB-4a): buckets the cart by product `groupCode`/`groupName` and lets the
 * seller set one percentage per group, applied in a single action. Matches `apps/web`'s `GroupDiscountDialog`
 * (`apps/web/src/components/discount-dialogs.tsx`) in behavior — the grouping itself, one discount per group,
 * a group left blank is untouched — but with a phone-appropriate scrollable list instead of a desktop dialog
 * grid (MOB-4). A line added from the catalog already knows its group; a line reopened from a saved draft does
 * not, so this sheet looks it up (one product read per distinct code still unknown) while it is open.
 */
interface Resolution {
  /** The `unknownKey` this answers for — a stale resolution (cart changed) is treated as not resolved yet. */
  readonly key: string;
  readonly lookup: ReadonlyMap<number, LineGroup>;
  readonly failed: boolean;
}

export function GroupDiscountSheet({ visible, lines, products, onApply, onClose }: GroupDiscountSheetProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  // Set only from inside the effect's async callback (never synchronously in the effect body), so `loading`
  // below is derived by comparing keys rather than an imperative setLoading(true)/setLoading(false) pair.
  const [resolution, setResolution] = useState<Resolution | null>(null);
  // A fresh sheet every time it opens: the previous percentages and lookups were already applied or discarded.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setValues({});
      setResolution(null);
    }
  }

  const unknownCodes = [...new Set(lines.filter((line) => line.group === undefined).map((line) => line.productCode))];
  const unknownKey = unknownCodes.join(",");
  const resolved = resolution?.key === unknownKey ? resolution : null;
  const loading = visible && unknownCodes.length > 0 && resolved === null;
  const lookup = resolved?.lookup ?? EMPTY_LOOKUP;
  const failed = resolved?.failed ?? false;

  useEffect(() => {
    if (!visible || unknownCodes.length === 0) return;
    let active = true;
    Promise.all(
      unknownCodes.map((code) =>
        products.get(code).then(
          (product): { code: number; group: LineGroup | null } => ({ code, group: { code: product.groupCode, name: product.groupName } }),
          (): { code: number; group: LineGroup | null } => ({ code, group: null }),
        ),
      ),
    ).then((results) => {
      if (!active) return;
      const next = new Map<number, LineGroup>();
      let anyFailed = false;
      for (const result of results) {
        if (result.group) next.set(result.code, result.group);
        else anyFailed = true;
      }
      setResolution({ key: unknownKey, lookup: next, failed: anyFailed });
    });
    return () => {
      active = false;
    };
    // `unknownKey` is the real dependency (a string summary of `unknownCodes`, itself derived from `lines`, which
    // is stable while the sheet stays open — nothing else mutates the cart behind an open modal).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, products, unknownKey]);

  const rows = groupRowsOf(lines, lookup);
  const entries = rows.map((row) => ({ row, text: values[row.key] ?? "" }));
  const filled = entries.filter(({ text }) => text.trim() !== "");
  const problems = new Map(
    filled.flatMap(({ row, text }) => {
      const parsed = parseDiscountInput(text);
      return parsed.ok ? [] : [[row.key, discountProblemMessages[parsed.problem]] as const];
    }),
  );
  const canApply = !loading && filled.length > 0 && problems.size === 0;

  function apply() {
    if (!canApply) return;
    const toApply = filled.flatMap(({ row, text }) => {
      const parsed = parseDiscountInput(text);
      return parsed.ok ? [{ key: row.key, discountText: discountTextOf(parsed.value) }] : [];
    });
    const result = applyGroupDiscounts(lines, toApply, (line) => groupKeyOf(groupOfLine(line, lookup)));
    onApply(result.lines, result.applied);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityRole="none">
          <Text style={styles.title}>Desconto por grupo</Text>
          <Text style={styles.description}>
            Um percentual por grupo de produtos do catálogo, para os itens do carrinho que pertencem a ele. Deixe em branco o grupo
            que não deve mudar.
          </Text>

          {loading ? (
            <View style={styles.loadingRow} accessibilityRole="progressbar" accessibilityLabel="Identificando os grupos dos itens">
              <ActivityIndicator color={colors.navy} />
              <Text style={styles.loadingText}>Identificando os grupos dos itens…</Text>
            </View>
          ) : (
            <>
              {failed && (
                <Text style={styles.warning} accessibilityRole="alert">
                  Não foi possível identificar o grupo de alguns itens; eles ficam de fora.
                </Text>
              )}
              {rows.length === 0 ? (
                <Text style={styles.empty}>Nenhum grupo identificado nos itens do carrinho.</Text>
              ) : (
                <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent} accessibilityLabel="Grupos do carrinho">
                  {rows.map((row) => {
                    const problem = problems.get(row.key);
                    return (
                      <View key={row.key} style={styles.row}>
                        <View style={styles.rowInfo}>
                          <Text style={styles.rowName} numberOfLines={1}>
                            {row.name}
                          </Text>
                          <Text style={styles.rowCount}>{`${plural(row.count, "item", "itens")} no carrinho`}</Text>
                        </View>
                        <View style={styles.rowField}>
                          <TextInput
                            style={[styles.input, problem !== undefined && styles.inputInvalid]}
                            value={values[row.key] ?? ""}
                            onChangeText={(text) => setValues((current) => ({ ...current, [row.key]: text }))}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            accessibilityLabel={`Desconto do grupo ${row.name} (%)`}
                          />
                          {problem !== undefined && <Text style={styles.error}>{problem}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}

          <View style={styles.buttons}>
            <Pressable style={styles.secondaryButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancelar">
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, !canApply && styles.primaryButtonDisabled]}
              onPress={apply}
              disabled={!canApply}
              accessibilityRole="button"
              accessibilityLabel="Aplicar descontos"
            >
              <Text style={styles.primaryButtonText}>Aplicar descontos</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(18, 23, 42, 0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: "80%",
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  description: { fontSize: 13, color: colors.textMuted },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  loadingText: { fontSize: 13, color: colors.textMuted },
  warning: { fontSize: 12, color: colors.warning },
  empty: { fontSize: 13, color: colors.textMuted, paddingVertical: spacing.md },
  rows: { flexGrow: 0 },
  rowsContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowInfo: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontSize: 14, fontWeight: "700", color: colors.text },
  rowCount: { fontSize: 12, color: colors.textMuted },
  rowField: { width: 96, gap: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlign: "right",
  },
  inputInvalid: { borderColor: colors.red },
  error: { color: colors.red, fontSize: 11 },
  buttons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  secondaryButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.text, fontWeight: "700", fontSize: 14 },
  primaryButton: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: 8, backgroundColor: colors.navy },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: colors.onNavy, fontWeight: "700", fontSize: 14 },
});
