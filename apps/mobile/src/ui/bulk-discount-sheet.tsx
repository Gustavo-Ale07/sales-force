import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import {
  applyDiscount,
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
import { colors, control, radius, spacing } from "../theme";

export const ALL_ITEMS_KEY = "__all__";

export interface BulkDiscountSheetProps {
  readonly visible: boolean;
  readonly lines: readonly EditorLine[];
  readonly products: ProductRepository;
  /** Lines picked in selection mode: the sheet then has no target selector and applies to them only. */
  readonly selectedKeys?: ReadonlySet<string>;
  /** Receives the lines carrying the new discount. The caller closes the sheet (it may ask a question first and leave it open). */
  readonly onApply: (before: readonly EditorLine[], after: EditorLine[], applied: number) => void;
  readonly onClose: () => void;
}

const EMPTY_LOOKUP: ReadonlyMap<number, LineGroup> = new Map();
const MAX_PERCENT = 99;

interface Resolution {
  /** The `unknownKey` this answers for: a stale resolution (cart changed) is treated as not resolved yet. */
  readonly key: string;
  readonly lookup: ReadonlyMap<number, LineGroup>;
}

const itensAfetados = (count: number) => `${count} ${count === 1 ? "item afetado" : "itens afetados"}`;

/** "−" / "+" on the typed percentage: one point per tap, kept inside 0..99, typed text stays pt-BR. */
export function stepPercentText(text: string, delta: 1 | -1): string {
  const parsed = parseDiscountInput(text);
  const current = parsed.ok ? Number(parsed.value) : 0;
  const next = Math.min(MAX_PERCENT, Math.max(0, Math.round((current + delta) * 100) / 100));
  return next === 0 ? "0" : String(next).replace(".", ",");
}

/**
 * The one bulk discount sheet (owner 2026-11-23): "Desconto em lote" for every item or for one catalog group (the group
 * of a line reopened from a saved draft is looked up while the sheet is open). One percentage, one target; the button
 * carries the number of affected items. Applying uses the same per-line iteration as before (`applyDiscount`).
 */
export function BulkDiscountSheet({ visible, lines, products, selectedKeys, onApply, onClose }: BulkDiscountSheetProps) {
  const window = useWindowDimensions();
  const [text, setText] = useState("");
  const [target, setTarget] = useState(ALL_ITEMS_KEY);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  // A fresh sheet every time it opens (state adjusted during render, never a flash of the previous values).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setText("");
      setTarget(ALL_ITEMS_KEY);
      setResolution(null);
    }
  }

  const selectedMode = selectedKeys !== undefined;
  const unknownCodes = selectedMode ? [] : [...new Set(lines.filter((line) => line.group === undefined).map((line) => line.productCode))];
  const unknownKey = unknownCodes.join(",");
  const resolved = resolution?.key === unknownKey ? resolution : null;
  const loading = visible && unknownCodes.length > 0 && resolved === null;
  const lookup = resolved?.lookup ?? EMPTY_LOOKUP;

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
      for (const result of results) if (result.group) next.set(result.code, result.group);
      setResolution({ key: unknownKey, lookup: next });
    });
    return () => {
      active = false;
    };
    // `unknownKey` is the real dependency (a string summary of `unknownCodes`, stable while the sheet stays open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, products, unknownKey]);

  const rows = selectedMode ? [] : groupRowsOf(lines, lookup);
  const match = (line: EditorLine): boolean => {
    if (selectedKeys !== undefined) return selectedKeys.has(line.key);
    return target === ALL_ITEMS_KEY || groupKeyOf(groupOfLine(line, lookup)) === target;
  };
  const affected = lines.filter((line) => match(line) && line.price.state !== "none").length;
  const parsed = parseDiscountInput(text);
  const empty = text.trim() === "";
  const problem = !empty && !parsed.ok ? discountProblemMessages[parsed.problem] : null;
  const canApply = !loading && !empty && parsed.ok && affected > 0;

  function apply() {
    if (!canApply || !parsed.ok) return;
    const result = applyDiscount(lines, discountTextOf(parsed.value), match);
    onApply(lines, result.lines, result.applied);
  }

  const listMaxHeight = Math.round(window.height * 0.28);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : "height"} testID="bulk-discount-avoiding">
        <View style={[styles.sheet, { maxHeight: Math.round(window.height * 0.92) }]} accessibilityRole="none">
          <Text style={styles.title} accessibilityRole="header">
            Desconto em lote
          </Text>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" testID="bulk-discount-scroll">
            {loading ? (
              <View style={styles.loadingRow} accessibilityRole="progressbar" accessibilityLabel="Identificando os grupos dos itens">
                <ActivityIndicator color={colors.navy} />
              </View>
            ) : (
              !selectedMode && (
                <ScrollView style={{ maxHeight: listMaxHeight }} nestedScrollEnabled accessibilityRole="radiogroup" accessibilityLabel="Aplicar em" testID="bulk-discount-targets">
                  <TargetRow label="Todos os itens" count={lines.length} checked={target === ALL_ITEMS_KEY} onPress={() => setTarget(ALL_ITEMS_KEY)} />
                  {rows.map((row) => (
                    <TargetRow key={row.key} label={row.name} count={row.count} checked={target === row.key} onPress={() => setTarget(row.key)} />
                  ))}
                </ScrollView>
              )
            )}

            <View style={styles.percentRow}>
              <Pressable
                style={styles.stepButton}
                onPress={() => setText((current) => stepPercentText(current, -1))}
                accessibilityRole="button"
                accessibilityLabel="Diminuir desconto"
                hitSlop={4}
              >
                <View style={[styles.stepBar, { backgroundColor: colors.navy }]} />
              </Pressable>
              <View style={styles.percentField}>
                <TextInput
                  style={[styles.input, problem !== null && styles.inputInvalid]}
                  value={text}
                  onChangeText={setText}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  selectTextOnFocus
                  accessibilityLabel="Desconto (%)"
                />
                <Text style={styles.percentSign}>%</Text>
              </View>
              <Pressable
                style={styles.stepButton}
                onPress={() => setText((current) => stepPercentText(current, 1))}
                accessibilityRole="button"
                accessibilityLabel="Aumentar desconto"
                hitSlop={4}
              >
                <View style={[styles.stepBar, { backgroundColor: colors.navy }]} />
                <View style={[styles.stepBar, styles.stepBarCross, { backgroundColor: colors.navy }]} />
              </Pressable>
            </View>
            {problem !== null && <Text style={styles.error}>{problem}</Text>}
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable
              style={[styles.applyButton, !canApply && styles.applyButtonDisabled]}
              onPress={apply}
              disabled={!canApply}
              accessibilityRole="button"
              accessibilityLabel="Aplicar desconto"
              accessibilityState={{ disabled: !canApply }}
              testID="bulk-discount-apply"
            >
              <Text style={styles.applyText}>Aplicar</Text>
              <Text style={styles.applyCount}>{itensAfetados(affected)}</Text>
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancelar">
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TargetRow({ label, count, checked, onPress }: { label: string; count: number; checked: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.targetRow, checked && styles.targetRowChecked]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <View style={[styles.radio, checked && styles.radioChecked]}>{checked && <View style={styles.radioDot} />}</View>
      <Text style={[styles.targetName, checked && styles.targetNameChecked]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.targetCount}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(18, 23, 42, 0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: spacing.lg,
    borderTopRightRadius: spacing.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { gap: spacing.md },
  loadingRow: { alignItems: "center", paddingVertical: spacing.lg },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: control.height,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  targetRowChecked: { borderColor: colors.navy, borderWidth: 2, backgroundColor: colors.background },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioChecked: { borderColor: colors.navy },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.navy },
  targetName: { flex: 1, fontSize: 14, color: colors.text },
  targetNameChecked: { fontWeight: "700" },
  targetCount: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  percentRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepButton: {
    width: control.heightLarge + spacing.sm,
    height: control.heightLarge + spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBar: { position: "absolute", width: 20, height: 3, borderRadius: 2 },
  stepBarCross: { transform: [{ rotate: "90deg" }] },
  percentField: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: control.heightLarge + spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 32,
    fontWeight: "800",
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: "center",
  },
  inputInvalid: { borderColor: colors.red },
  percentSign: { fontSize: 24, fontWeight: "800", color: colors.textMuted },
  error: { color: colors.red, fontSize: 12 },
  buttons: { gap: spacing.sm },
  applyButton: {
    minHeight: control.heightLarge + spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  applyButtonDisabled: { opacity: 0.5 },
  applyText: { color: colors.onNavy, fontSize: 16, fontWeight: "800" },
  applyCount: { color: colors.onNavy, fontSize: 12, fontWeight: "600" },
  cancelButton: {
    minHeight: control.height,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: colors.text, fontSize: 14, fontWeight: "700" },
});
