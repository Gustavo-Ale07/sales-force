import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import { commitQuantityText, quantityProblemMessages, type QuantityCommit, type QuantityProblem } from "../data/order-draft";
import { colors, spacing } from "../theme";

export interface QuantityFieldProps {
  /** Last valid quantity as the order holds it. */
  readonly value: string;
  readonly productName: string;
  /** Zero removes the product (catalog) instead of going back to the last value (cart). */
  readonly zeroRemoves: boolean;
  readonly onCommit: (result: Exclude<QuantityCommit, { kind: "revert" }>) => void;
  readonly style?: StyleProp<TextStyle>;
  /** Show the inline problem under the field (the cart does; the compact catalog control shows it as a small line too). */
  readonly compact?: boolean;
}

/**
 * The number between "−" and "+": editable, with the same validity as the steppers (`commitQuantityText`). Typing
 * only changes a local draft; the order changes on blur or "enter", and an invalid value goes back to the last valid
 * one with the standard inline message.
 */
export function QuantityField({ value, productName, zeroRemoves, onCommit, style, compact }: QuantityFieldProps): ReactNode {
  // Draft and problem remember the value they were made against: a change from outside (+/−, reload) discards them.
  const [typed, setTyped] = useState<{ readonly base: string; readonly text: string } | null>(null);
  const [failed, setFailed] = useState<{ readonly base: string; readonly problem: QuantityProblem } | null>(null);
  const draft = typed !== null && typed.base === value ? typed.text : null;
  const problem = failed !== null && failed.base === value ? failed.problem : null;
  const setDraft = (text: string | null) => setTyped(text === null ? null : { base: value, text });
  const setProblem = (next: QuantityProblem | null) => setFailed(next === null ? null : { base: value, problem: next });

  function commit() {
    if (draft === null) return;
    const result = commitQuantityText(draft, zeroRemoves);
    setDraft(null);
    if (result.kind === "revert") {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    if (result.kind === "set" && result.quantityText === value) return;
    onCommit(result);
  }

  return (
    <View style={styles.wrap}>
      <TextInput
        style={[styles.input, compact && styles.inputCompact, problem !== null && styles.inputError, style]}
        value={draft ?? value}
        onChangeText={(text) => {
          setDraft(text);
          setProblem(null);
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="decimal-pad"
        returnKeyType="done"
        selectTextOnFocus
        maxFontSizeMultiplier={1.3}
        accessibilityLabel={`Quantidade de ${productName}`}
      />
      {problem !== null && <Text style={styles.error}>{quantityProblemMessages[problem]}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // minWidth 0 + flexShrink: a native TextInput has a wide intrinsic width and must never size its container.
  wrap: { flex: 1, flexShrink: 1, minWidth: 0 },
  input: {
    minWidth: 0,
    width: "100%",
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: "center",
  },
  inputCompact: { minHeight: 44, borderWidth: 0, fontSize: 15, fontWeight: "800", backgroundColor: "transparent", paddingHorizontal: 0 },
  inputError: { borderColor: colors.red },
  error: { color: colors.red, fontSize: 11, textAlign: "center" },
});
