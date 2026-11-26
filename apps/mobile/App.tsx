import { useEffect, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { apiConfig } from "./src/config";
import { deleteDatabaseFile } from "@salesforce/mobile-db/expo";
import { APP_DATABASE_NAME, openAppDatabase } from "./src/db/app-database";
import { createSecureInstallIdStore } from "./src/device/secure-install-id";
import { DeviceNoticeScreen } from "./src/ui/device-notice-screen";
import { createAppDependencies, type AppDependencies } from "./src/dependencies";
import { S7DiagnosticsScreen } from "./src/dev/s7-diagnostics-screen";
import { colors, spacing } from "./src/theme";
import { SplashView } from "./src/ui/brand";
import { Shell } from "./src/ui/shell";
import { UpdateGate } from "./src/ui/update-gate";
import { installUpdate, startupUpdateCheck } from "./src/update/device-update";

function ConfigError({ reason }: { reason: "missing" | "invalid" | "insecure" }) {
  return (
    <View style={styles.configError}>
      <Text style={styles.configTitle}>Servidor não configurado</Text>
      <Text style={styles.configText}>
        {reason === "missing"
          ? "Defina EXPO_PUBLIC_API_URL com o endereço do servidor (por exemplo http://192.168.0.10:3000) e gere o aplicativo novamente."
          : reason === "insecure"
            ? "Este aplicativo só aceita um servidor com https://. Defina EXPO_PUBLIC_API_URL com um endereço https:// e gere o aplicativo novamente."
            : "EXPO_PUBLIC_API_URL deve ser apenas o endereço do servidor (http:// ou https://, sem caminho)."}
      </Text>
    </View>
  );
}

// The native splash stays up until the first React frame is laid out, then hands over to the (identical) JS splash: no blank flash.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Spike S7 (V-09): build-time flag, never set in a real build. Inlined by Expo at bundle time. */
const S7_DIAGNOSTICS = process.env.EXPO_PUBLIC_S7_DIAGNOSTICS === "1";

type Boot = { readonly phase: "opening" } | { readonly phase: "ready"; readonly dependencies: AppDependencies } | { readonly phase: "failed" } | { readonly phase: "key_lost" };

/** The secure-store key is gone while the database file remains: the data cannot be opened (`KeyMissingError`, packages/mobile-db). */
function isKeyLost(error: unknown): boolean {
  return error instanceof Error && error.name === "KeyMissingError";
}

/** Chave local perdida: the only way forward is to delete the unreadable data (never a silent overwrite); the server resends it at sign-in. */
function KeyLostScreen({ onReset }: { onReset: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <DeviceNoticeScreen
      kind="key_lost"
      busy={busy}
      onAction={() => {
        setBusy(true);
        void onReset().finally(() => setBusy(false));
      }}
    />
  );
}

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
function useBoot(): { readonly boot: Boot; readonly resetLocalData: () => Promise<void> } {
  const [boot, setBoot] = useState<Boot>({ phase: "opening" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!apiConfig.ok || S7_DIAGNOSTICS) return undefined;
    const baseUrl = apiConfig.baseUrl;
    let active = true;
    openAppDatabase()
      .then((opened) => {
        if (active) setBoot({ phase: "ready", dependencies: createAppDependencies(baseUrl, opened.database) });
      })
      .catch((error: unknown) => {
        if (active) setBoot({ phase: isKeyLost(error) ? "key_lost" : "failed" });
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const resetLocalData = async () => {
    await deleteDatabaseFile(APP_DATABASE_NAME);
    await createSecureInstallIdStore().reset().catch(() => undefined);
    setBoot({ phase: "opening" });
    setAttempt((current) => current + 1);
  };
  return { boot, resetLocalData };
}

export default function App() {
  const { boot, resetLocalData } = useBoot();
  // Screens own their insets (header, bottom navigation, login); only the plain status screens need the wrapper.
  const safe = (content: React.ReactNode) => (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {content}
    </SafeAreaView>
  );
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <View style={styles.root} onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)}>
        {S7_DIAGNOSTICS ? (
          safe(<S7DiagnosticsScreen />)
        ) : !apiConfig.ok ? (
          safe(<ConfigError reason={apiConfig.reason} />)
        ) : boot.phase === "ready" ? (
          <UpdateGate {...(startupUpdateCheck ? { check: startupUpdateCheck } : {})} install={installUpdate}>
            <Shell dependencies={boot.dependencies} />
          </UpdateGate>
        ) : boot.phase === "key_lost" ? (
          <KeyLostScreen onReset={resetLocalData} />
        ) : boot.phase === "failed" ? (
          safe(<DatabaseError />)
        ) : (
          <SplashView />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  safe: { flex: 1, backgroundColor: colors.background },
  configError: { flex: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background, gap: spacing.md },
  configTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  configText: { fontSize: 15, color: colors.textMuted },
});
