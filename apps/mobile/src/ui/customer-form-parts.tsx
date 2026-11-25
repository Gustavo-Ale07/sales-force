import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, control, radius, spacing } from "../theme";
import { BackLink } from "./back-link";
import { Icon } from "./icons";

/** Labelled text input with its own error line; shared by the customer create and edit forms. */
export function FormField({ label, value, onChangeText, error, required, multiline, ...rest }: { label: string; value: string; onChangeText: (text: string) => void; error?: string | null; required?: boolean; multiline?: boolean } & Omit<TextInputProps, "value" | "onChangeText" | "multiline">) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{required ? `${label} *` : label}</Text>
      <TextInput
        style={[styles.input, multiline === true && styles.multiline, error ? styles.inputError : null]}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        {...rest}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** A checkbox row drawn with views (vector check, no glyph). */
export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <Pressable style={styles.checkRow} onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }}>
      <View style={[styles.box, checked && styles.boxOn]}>{checked && <Icon name="check" color={colors.onNavy} size={16} />}</View>
      <Text style={styles.checkText}>{label}</Text>
    </Pressable>
  );
}

export function Banner({ text, tone = "danger" }: { text: string; tone?: "danger" | "warning" | "info" }) {
  return (
    <View style={[styles.banner, tone === "danger" ? styles.bannerDanger : tone === "warning" ? styles.bannerWarning : styles.bannerInfo]} accessibilityRole="alert">
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

export function FormFrame({ title, backLabel, onCancel, children, footer }: { title: string; backLabel: string; onCancel: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <View style={styles.frame}>
      <View style={styles.bar}>
        <BackLink label={backLabel} onPress={onCancel} accessibilityLabel={`Voltar para ${backLabel}`} />
      </View>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
      <View style={styles.footer}>{footer}</View>
    </View>
  );
}

export function FormButton({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.button, primary === true ? styles.buttonPrimary : styles.buttonSecondary, disabled === true && styles.disabled]}
      onPress={() => disabled !== true && onPress()}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
    >
      <Text style={[styles.buttonText, primary === true ? styles.buttonTextPrimary : styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

export const formStyles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  group: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  groupTitle: { fontSize: 14, fontWeight: "800", color: colors.navy },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: control.height, minWidth: control.height, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.navy },
  chipText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  chipTextOn: { color: colors.onNavy },
  resultTitle: { fontSize: 18, fontWeight: "800", color: colors.navy },
  resultText: { fontSize: 15, color: colors.text },
});

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  bar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.sm },
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { fontSize: 20, fontWeight: "800", color: colors.navy },
  field: { gap: 2 },
  label: { fontSize: 12, color: colors.textMuted },
  input: { minHeight: control.height, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  multiline: { minHeight: 96, textAlignVertical: "top", paddingVertical: spacing.sm },
  inputError: { borderColor: colors.red },
  error: { fontSize: 12, color: colors.red, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: control.height },
  box: { width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: colors.navy, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.navy },
  checkText: { fontSize: 15, color: colors.text },
  banner: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  bannerDanger: { borderColor: colors.red, backgroundColor: colors.surface },
  bannerWarning: { borderColor: colors.warning, backgroundColor: colors.surface },
  bannerInfo: { borderColor: colors.navy, backgroundColor: colors.surface },
  bannerText: { fontSize: 14, color: colors.text, fontWeight: "600" },
  footer: { flexDirection: "row", gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  button: { flex: 1, minHeight: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  buttonPrimary: { backgroundColor: colors.red },
  buttonSecondary: { borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.surface },
  disabled: { opacity: 0.4 },
  buttonText: { fontSize: 16, fontWeight: "800" },
  buttonTextPrimary: { color: colors.onNavy },
  buttonTextSecondary: { color: colors.navy },
});
