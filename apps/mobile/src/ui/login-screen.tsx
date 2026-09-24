import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Account, AuthPort, LoginResult } from "../auth/auth-port";
import { validateLoginForm, type LoginFormErrors } from "../auth/login-form";
import { colors, spacing } from "../theme";

type LoginFailure = Extract<LoginResult, { ok: false }>;

export function describeLoginFailure(failure: LoginFailure): string {
  switch (failure.reason) {
    case "invalid_credentials":
      return "E-mail ou senha inválidos.";
    case "rate_limited":
      return failure.retryAfterSeconds !== undefined
        ? `Muitas tentativas. Tente novamente em ${failure.retryAfterSeconds} segundos.`
        : "Muitas tentativas. Aguarde alguns instantes e tente novamente.";
    case "unavailable":
      return "Não foi possível entrar agora. Verifique sua conexão e tente novamente.";
  }
}

export interface LoginScreenProps {
  readonly auth: AuthPort;
  readonly onAuthenticated: (account: Account) => void;
}

export function LoginScreen({ auth, onAuthenticated }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    setFailure(null);
    const checked = validateLoginForm({ email, password });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const result = await auth.login(checked.value);
      if (result.ok) onAuthenticated(result.account);
      else setFailure(describeLoginFailure(result));
    } catch {
      setFailure(describeLoginFailure({ ok: false, reason: "unavailable" }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.card}>
        <Text style={styles.brand} accessibilityRole="header">
          PLAC
        </Text>
        <Text style={styles.title}>Entrar no Sales Force</Text>

        <Text style={styles.label}>E-mail</Text>
        <TextInput
          style={[styles.input, errors.email !== undefined && styles.inputError]}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          editable={!submitting}
          accessibilityLabel="E-mail"
        />
        {errors.email !== undefined && <Text style={styles.fieldError}>{errors.email}</Text>}

        <Text style={styles.label}>Senha</Text>
        <TextInput
          style={[styles.input, errors.password !== undefined && styles.inputError]}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          autoComplete="current-password"
          editable={!submitting}
          onSubmitEditing={() => void submit()}
          accessibilityLabel="Senha"
        />
        {errors.password !== undefined && <Text style={styles.fieldError}>{errors.password}</Text>}

        {failure !== null && (
          <Text style={styles.failure} accessibilityRole="alert">
            {failure}
          </Text>
        )}

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={() => void submit()}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Entrar"
        >
          {submitting ? <ActivityIndicator color={colors.onNavy} /> : <Text style={styles.buttonText}>Entrar</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: colors.background },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.xl, gap: spacing.sm },
  brand: { fontSize: 28, fontWeight: "800", color: colors.navy, letterSpacing: 2 },
  title: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  inputError: { borderColor: colors.red },
  fieldError: { fontSize: 13, color: colors.red },
  failure: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.errorBackground,
    color: colors.red,
    fontSize: 14,
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onNavy, fontSize: 16, fontWeight: "700" },
});
