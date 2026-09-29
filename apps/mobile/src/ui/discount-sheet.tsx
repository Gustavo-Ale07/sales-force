import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { applyDiscount, discountProblemMessages, discountTextOf, parseDiscountInput, type EditorLine } from "../data/order-draft";
import { colors, spacing } from "../theme";

export interface DiscountSheetProps {
  readonly visible: boolean;
  readonly title: string;
  /** One line of context shown under the title (e.g. how many lines this applies to). */
  readonly description: string;
  readonly lines: readonly EditorLine[];
  /** Which lines this application targets: every line (mass apply) or a selected subset (group apply). */
  readonly match: (line: EditorLine) => boolean;
  /** Replaces the lines with the ones that carry the new discount. */
  readonly onApply: (lines: EditorLine[], applied: number) => void;
  readonly onClose: () => void;
}

/**
 * Percentage entry for mass apply (every cart line) and group apply (a selected subset), phone-appropriate: one
 * full-width bottom sheet instead of the desktop's two separate dialogs. Both share the exact same domain-backed
 * iteration (`applyDiscount` in `order-draft.ts`), matching `apps/web`'s mass/group discount logic one for one —
 * no new commercial rule, only where each percentage is typed and which lines it targets.
 */
export function DiscountSheet({ visible, title, description, lines, match, onApply, onClose }: DiscountSheetProps) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  // A fresh field every time the sheet opens: the previous percentage was already applied or discarded. Adjusting
  // state during render (React's documented pattern for "resetting state when a prop changes") instead of an
  // effect, so the reset is visible in the very first render of the open sheet, never a flash of stale text.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setText("");
      setTouched(false);
    }
  }

  const matched = lines.filter(match);
  const priced = matched.filter((line) => line.price.state !== "none").length;
  const withoutPrice = matched.length - priced;
  const parsed = parseDiscountInput(text);
  const problem = touched && !parsed.ok ? discountProblemMessages[parsed.problem] : null;

  function submit() {
    setTouched(true);
    if (!parsed.ok) return;
    const result = applyDiscount(lines, discountTextOf(parsed.value), match);
    onApply(result.lines, result.applied);
  }

  function remove() {
    const result = applyDiscount(lines, "", match);
    onApply(result.lines, result.applied);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityRole="none">
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
          <TextInput
            style={[styles.input, problem !== null && styles.inputInvalid]}
            value={text}
            onChangeText={(value) => {
              setText(value);
              setTouched(true);
            }}
            keyboardType="decimal-pad"
            placeholder="0"
            autoFocus
            accessibilityLabel={`${title} (%)`}
          />
          {problem !== null && <Text style={styles.error}>{problem}</Text>}
          <Text style={styles.info} accessibilityLiveRegion="polite">
            {`${priced} ${priced === 1 ? "item recebe" : "itens recebem"} o desconto.`}
            {withoutPrice > 0 ? ` ${withoutPrice} ${withoutPrice === 1 ? "item sem preço fica" : "itens sem preço ficam"} de fora.` : ""}
          </Text>
          <View style={styles.buttons}>
            <Pressable style={styles.secondaryButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancelar">
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={remove} accessibilityRole="button" accessibilityLabel="Remover descontos">
              <Text style={styles.secondaryButtonText}>Remover</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={submit} accessibilityRole="button" accessibilityLabel="Aplicar desconto">
              <Text style={styles.primaryButtonText}>Aplicar</Text>
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
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  description: { fontSize: 13, color: colors.textMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 20,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputInvalid: { borderColor: colors.red },
  error: { color: colors.red, fontSize: 12 },
  info: { fontSize: 12, color: colors.textMuted },
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
  primaryButtonText: { color: colors.onNavy, fontWeight: "700", fontSize: 14 },
});
