import { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import type { Account, AuthPort, LoginResult } from "../auth/auth-port";
import { validateLoginForm, type LoginFormErrors } from "../auth/login-form";
import { APP_ENVIRONMENT_LABEL, APP_VERSION, PRODUCT_NAME } from "../app-info";
import type { ConnectivityState } from "../connectivity/connectivity";
import { colors, spacing } from "../theme";
import { BrandLogo } from "./brand";
import { useInsets } from "./use-insets";

type LoginFailure = Extract<LoginResult, { ok: false }>;

export function describeLoginFailure(failure: LoginFailure): string {
  switch (failure.reason) {
    case "invalid_credentials":
      return "Usuário ou senha inválidos.";
    case "rate_limited":
      return failure.retryAfterSeconds !== undefined
        ? `Muitas tentativas. Tente novamente em ${failure.retryAfterSeconds} segundos.`
        : "Muitas tentativas. Aguarde alguns instantes e tente novamente.";
    case "unavailable":
      return "Não foi possível realizar a autenticação no momento. Tente novamente.";
  }
}

export interface LoginScreenProps {
  readonly auth: AuthPort;
  readonly onAuthenticated: (account: Account) => void;
  /** Only used to explain why signing in is not possible right now; the offline session gate lives in the Shell. */
  readonly connectivity?: ConnectivityState;
}

export function LoginScreen({ auth, onAuthenticated, connectivity }: LoginScreenProps) {
  const insets = useInsets();
  const passwordRef = useRef<TextInput>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    setFailure(null);
    const checked = validateLoginForm({ username, password });
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
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <BrandLogo height={52} />
          <Text style={styles.product} accessibilityRole="header">
            {PRODUCT_NAME}
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Usuário</Text>
          <TextInput
            style={[styles.input, errors.username !== undefined && styles.inputError]}
            value={username}
            onChangeText={setUsername}
            placeholder="Digite seu usuário"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            autoComplete="username"
            returnKeyType="next"
            editable={!submitting}
            onSubmitEditing={() => passwordRef.current?.focus()}
            accessibilityLabel="Usuário"
          />
          {errors.username !== undefined && <Text style={styles.fieldError}>{errors.username}</Text>}

          <Text style={styles.label}>Senha</Text>
          <View style={[styles.passwordRow, errors.password !== undefined && styles.inputError]}>
            <TextInput
              ref={passwordRef}
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              autoComplete="current-password"
              returnKeyType="go"
              editable={!submitting}
              onSubmitEditing={() => void submit()}
              accessibilityLabel="Senha"
            />
            <Pressable
              onPress={() => setShowPassword((current) => !current)}
              style={styles.toggle}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Ocultar senha" : "Mostrar senha"}
              hitSlop={8}
            >
              <Text style={styles.toggleText}>{showPassword ? "Ocultar" : "Mostrar"}</Text>
            </Pressable>
          </View>
          {errors.password !== undefined && <Text style={styles.fieldError}>{errors.password}</Text>}

          {connectivity === "offline" && (
            <Text style={styles.offline} accessibilityRole="alert">
              Sem conexão. Conecte-se à internet para entrar.
            </Text>
          )}
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

        <Text style={styles.footer}>{`${PRODUCT_NAME} · v${APP_VERSION}${APP_ENVIRONMENT_LABEL !== null ? ` · ${APP_ENVIRONMENT_LABEL}` : ""}`}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.xl },
  brand: { alignItems: "center", gap: spacing.md },
  product: { fontSize: 24, fontWeight: "800", color: colors.navy, letterSpacing: 1 },
  form: { gap: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  passwordInput: { flex: 1, paddingHorizontal: spacing.md, minHeight: 48, fontSize: 16, color: colors.text },
  toggle: { paddingHorizontal: spacing.md, minHeight: 48, justifyContent: "center" },
  toggleText: { fontSize: 13, fontWeight: "700", color: colors.navy },
  inputError: { borderColor: colors.red },
  fieldError: { fontSize: 13, color: colors.red },
  offline: { fontSize: 13, color: colors.warning },
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
    alignItems: "center",
    minHeight: 50,
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onNavy, fontSize: 16, fontWeight: "700" },
  footer: { textAlign: "center", fontSize: 12, color: colors.textMuted },
});
