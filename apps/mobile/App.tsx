import { useEffect, useState } from "react";
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { apiConfig } from "./src/config";
import { openAppDatabase } from "./src/db/app-database";
import { createAppDependencies, type AppDependencies } from "./src/dependencies";
import { S7DiagnosticsScreen } from "./src/dev/s7-diagnostics-screen";
import { colors, spacing } from "./src/theme";
import { Shell } from "./src/ui/shell";

function ConfigError({ reason }: { reason: "missing" | "invalid" }) {
  return (
    <View style={styles.configError}>
      <Text style={styles.configTitle}>Servidor não configurado</Text>
      <Text style={styles.configText}>
        {reason === "missing"
          ? "Defina EXPO_PUBLIC_API_URL com o endereço do servidor (por exemplo http://192.168.0.10:3000) e gere o aplicativo novamente."
          : "EXPO_PUBLIC_API_URL deve ser apenas o endereço do servidor (http:// ou https://, sem caminho)."}
      </Text>
    </View>
  );
}

/** Spike S7 (V-09): build-time flag, never set in a real build. Inlined by Expo at bundle time. */
const S7_DIAGNOSTICS = process.env.EXPO_PUBLIC_S7_DIAGNOSTICS === "1";

type Boot = { readonly phase: "opening" } | { readonly phase: "ready"; readonly dependencies: AppDependencies } | { readonly phase: "failed" };

function DatabaseError() {
  return (
    <View style={styles.configError}>
      <Text style={styles.configTitle}>Não foi possível abrir os dados do aparelho</Text>
      <Text style={styles.configText}>
        O banco de dados protegido deste aparelho não abriu. Por segurança o aplicativo não segue sem ele. Feche e abra o aplicativo; se persistir, contate o suporte.
      </Text>
    </View>
  );
}

/** The encrypted database opens before anything else and never falls back to plaintext or to online-only (MOB-6). */
function useBoot(): Boot {
  const [boot, setBoot] = useState<Boot>({ phase: "opening" });
  useEffect(() => {
    if (!apiConfig.ok || S7_DIAGNOSTICS) return undefined;
    const baseUrl = apiConfig.baseUrl;
    let active = true;
    openAppDatabase()
      .then((opened) => {
        if (active) setBoot({ phase: "ready", dependencies: createAppDependencies(baseUrl, opened.database) });
      })
      .catch(() => {
        if (active) setBoot({ phase: "failed" });
      });
    return () => {
      active = false;
    };
  }, []);
  return boot;
}

export default function App() {
  const boot = useBoot();
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        {S7_DIAGNOSTICS ? (
          <S7DiagnosticsScreen />
        ) : !apiConfig.ok ? (
          <ConfigError reason={apiConfig.reason} />
        ) : boot.phase === "ready" ? (
          <Shell dependencies={boot.dependencies} />
        ) : boot.phase === "failed" ? (
          <DatabaseError />
        ) : (
          <View style={styles.boot}>
            <ActivityIndicator color={colors.navy} />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  configError: { flex: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background, gap: spacing.md },
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  configTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  configText: { fontSize: 15, color: colors.textMuted },
});
