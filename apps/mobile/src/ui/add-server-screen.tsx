import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { INVALID_CODE_MESSAGE } from "../server/add-server";
import { colors, spacing } from "../theme";
import { useInsets } from "./use-insets";

export interface AddServerScreenProps {
  /** Resolves `true` when the server accepted the code (the app then moves on) and `false` otherwise. */
  readonly onSubmit: (code: string) => Promise<boolean>;
}

/** The only screen without a server code: one field, one button; the only message is "Código inválido". */
export function AddServerScreen({ onSubmit }: AddServerScreenProps) {
  const insets = useInsets();
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setInvalid(false);
    try {
      const accepted = await onSubmit(code);
      if (!accepted) setInvalid(true);
    } catch {
      setInvalid(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.title} accessibilityRole="header">
          Adicionar servidor
        </Text>
        <TextInput
          style={[styles.input, invalid && styles.inputError]}
          value={code}
          onChangeText={(text) => {
            setCode(text);
            setInvalid(false);
          }}
          placeholder="Código"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          multiline
          editable={!busy}
          accessibilityLabel="Código"
        />
        {invalid && (
          <Text style={styles.error} accessibilityRole="alert">
            {INVALID_CODE_MESSAGE}
          </Text>
        )}
        <Pressable
          style={[styles.button, (busy || code.trim().length === 0) && styles.buttonDisabled]}
          onPress={() => void submit()}
          disabled={busy || code.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Adicionar"
        >
          {busy ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Adicionar</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  input: { minHeight: 96, maxHeight: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, fontSize: 14, color: colors.text, textAlignVertical: "top" },
  inputError: { borderColor: colors.red },
  error: { fontSize: 14, color: colors.red },
  button: { minHeight: 48, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.text, paddingHorizontal: spacing.lg },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 16, fontWeight: "600", color: colors.background },
});
