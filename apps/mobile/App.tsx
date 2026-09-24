import { useMemo } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { apiConfig } from "./src/config";
import { createAppDependencies } from "./src/dependencies";
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

export default function App() {
  const dependencies = useMemo(() => (apiConfig.ok ? createAppDependencies(apiConfig.baseUrl) : null), []);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        {dependencies !== null ? <Shell dependencies={dependencies} /> : <ConfigError reason={apiConfig.ok ? "invalid" : apiConfig.reason} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  configError: { flex: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background, gap: spacing.md },
  configTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  configText: { fontSize: 15, color: colors.textMuted },
});
