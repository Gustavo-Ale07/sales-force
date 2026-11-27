import { useEffect, useRef, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { apiConfig } from "./src/config";
import { deleteDatabaseFile } from "@salesforce/mobile-db/expo";
import { APP_DATABASE_NAME, openAppDatabase } from "./src/db/app-database";
import { DeviceNoticeScreen } from "./src/ui/device-notice-screen";
import { createAppDependencies, type AppDependencies } from "./src/dependencies";
import { S7DiagnosticsScreen } from "./src/dev/s7-diagnostics-screen";
import { addServer, loadStoredServer } from "./src/server/add-server";
import { createSecureServerCodeStore } from "./src/server/secure-server-code-store";
import { onServerCodeRejected, setServerConnection, type ServerConnection } from "./src/server/server-connection";
import { colors, spacing } from "./src/theme";
import { AddServerScreen } from "./src/ui/add-server-screen";
import { SplashView } from "./src/ui/brand";
import { Shell } from "./src/ui/shell";
import { UpdateGate } from "./src/ui/update-gate";
import { installUpdate, startupUpdateCheck } from "./src/update/device-update";

// The native splash stays up until the first React frame is laid out, then hands over to the (identical) JS splash: no blank flash.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Spike S7 (V-09): build-time flag, never set in a real build. Inlined by Expo at bundle time. */
const S7_DIAGNOSTICS = process.env.EXPO_PUBLIC_S7_DIAGNOSTICS === "1";

type Boot = { readonly phase: "add_server" } | { readonly phase: "opening" } | { readonly phase: "ready"; readonly dependencies: AppDependencies } | { readonly phase: "failed" } | { readonly phase: "key_lost" };

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

const codeStore = createSecureServerCodeStore();

/** Development only: the build-time address stands in for a server code (no key; the server guard is then off or the code is added by hand). */
function developmentFallback(): ServerConnection | null {
  if (!__DEV__ || !apiConfig.ok) return null;
  return { baseUrl: apiConfig.baseUrl, origin: new URL(apiConfig.baseUrl).origin, key: "" };
}

/**
 * The server code decides where the app talks to (the address inside it) and is sent on every request. Without a stored code the
 * only screen is "Adicionar servidor". The encrypted database opens only after that, before anything else, and never falls back to
 * plaintext or to online-only (MOB-6). A guard 401 (code rotated) forgets the code and the local session and returns to the start.
 */
function useBoot(): { readonly boot: Boot; readonly resetLocalData: () => Promise<void>; readonly submitCode: (code: string) => Promise<boolean> } {
  const [boot, setBoot] = useState<Boot>({ phase: "opening" });
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState<ServerConnection | null | "loading">("loading");
  const noFallback = useRef(false);
  const current = useRef<Boot>(boot);
  useEffect(() => {
    current.current = boot;
  }, [boot]);

  useEffect(() => {
    let active = true;
    void loadStoredServer(codeStore).then((stored) => {
      if (!active) return;
      const next = stored.kind === "ready" ? stored.connection : noFallback.current ? null : developmentFallback();
      setConnection(next);
      if (next === null) setBoot({ phase: "add_server" });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      onServerCodeRejected(() => {
        noFallback.current = true;
        const running = current.current;
        void (async () => {
          if (running.phase === "ready") await running.dependencies.offline?.session.forget().catch(() => undefined);
          await codeStore.clear().catch(() => undefined);
          setServerConnection(null);
          setConnection(null);
          setBoot({ phase: "add_server" });
        })();
      }),
    [],
  );

  useEffect(() => {
    if (connection === "loading" || connection === null || S7_DIAGNOSTICS) return undefined;
    setServerConnection(connection.key === "" ? null : connection);
    const baseUrl = connection.baseUrl;
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
  }, [attempt, connection]);

  const submitCode = async (raw: string): Promise<boolean> => {
    const accepted = await addServer(raw, { store: codeStore });
    if (accepted === null) return false;
    setBoot({ phase: "opening" });
    setConnection(accepted);
    return true;
  };
  const resetLocalData = async () => {
    await deleteDatabaseFile(APP_DATABASE_NAME);
    setBoot({ phase: "opening" });
    setAttempt((value) => value + 1);
  };
  return { boot, resetLocalData, submitCode };
}

export default function App() {
  const { boot, resetLocalData, submitCode } = useBoot();
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
        ) : boot.phase === "add_server" ? (
          <AddServerScreen onSubmit={submitCode} />
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
