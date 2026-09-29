import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { getLocalStorageStatus } from "@salesforce/mobile-db";
import { useConnectivity } from "../connectivity/use-connectivity";
import type { Account } from "../auth/auth-port";
import type { AppDependencies } from "../dependencies";
import { colors, spacing } from "../theme";
import { ConnectivityBadge } from "./connectivity-badge";
import { CustomersScreen } from "./customers-screen";
import { LoginScreen } from "./login-screen";
import { NewOrderScreen } from "./new-order-screen";
import { ProductsScreen } from "./products-screen";

type Session = { readonly phase: "checking" } | { readonly phase: "anonymous" } | { readonly phase: "authenticated"; readonly account: Account };
type Tab = "customers" | "products" | "newOrder";

const TAB_LABEL: Record<Tab, string> = { customers: "Clientes", products: "Catálogo", newOrder: "Novo pedido" };

/** Offline banner. Honest about the current state: there is no offline data until spike S7 (MOB-2, V-09). */
export function OfflineNotice() {
  const storage = getLocalStorageStatus();
  return (
    <View style={styles.offlineNotice} accessibilityRole="alert">
      <Text style={styles.offlineText}>
        {storage.available
          ? "Sem conexão. Exibindo os dados salvos neste aparelho."
          : "Sem conexão. Esta versão ainda não guarda dados no aparelho: as listas dependem da internet."}
      </Text>
    </View>
  );
}

/** Session gate + the two read-only lists. Everything it touches comes through `dependencies` (ports). */
export function Shell({ dependencies }: { dependencies: AppDependencies }) {
  const { auth, repositories, connectivity } = dependencies;
  const [session, setSession] = useState<Session>({ phase: "checking" });
  const [tab, setTab] = useState<Tab>("customers");
  const connectivityState = useConnectivity(connectivity);

  useEffect(() => {
    let active = true;
    auth
      .getSession()
      .then((account) => {
        if (active) setSession(account === null ? { phase: "anonymous" } : { phase: "authenticated", account });
      })
      .catch(() => {
        // Could not reach the server: show the login form; signing in reports the real problem.
        if (active) setSession({ phase: "anonymous" });
      });
    return () => {
      active = false;
    };
  }, [auth]);

  const expire = useCallback(() => setSession({ phase: "anonymous" }), []);

  async function signOut() {
    try {
      await auth.logout();
    } catch {
      // The server session may outlive a failed call, but the screen must not keep showing private data.
    }
    setSession({ phase: "anonymous" });
  }

  if (session.phase === "checking") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.navy} />
      </View>
    );
  }

  if (session.phase === "anonymous") {
    return (
      <View style={styles.flex}>
        <View style={styles.loginStatus}>
          <ConnectivityBadge state={connectivityState} />
        </View>
        <LoginScreen auth={auth} onAuthenticated={(account) => setSession({ phase: "authenticated", account })} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>PLAC Sales Force</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {session.account.displayName}
          </Text>
        </View>
        <ConnectivityBadge state={connectivityState} />
        <Pressable onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Sair">
          <Text style={styles.signOut}>Sair</Text>
        </Pressable>
      </View>
      {connectivityState === "offline" && <OfflineNotice />}
      <View style={styles.tabs} accessibilityRole="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
          <Pressable
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{TAB_LABEL[key]}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "customers" && <CustomersScreen customers={repositories.customers} onUnauthenticated={expire} />}
      {tab === "products" && <ProductsScreen products={repositories.products} onUnauthenticated={expire} />}
      {tab === "newOrder" && <NewOrderScreen repositories={repositories} onUnauthenticated={expire} />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  loginStatus: { alignItems: "flex-end", padding: spacing.md, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerText: { flex: 1 },
  title: { color: colors.onNavy, fontSize: 16, fontWeight: "800" },
  subtitle: { color: colors.onNavy, fontSize: 12, opacity: 0.8 },
  signOut: { color: colors.onNavy, fontSize: 14, fontWeight: "700", paddingHorizontal: spacing.sm },
  offlineNotice: { backgroundColor: colors.errorBackground, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  offlineText: { color: colors.text, fontSize: 13 },
  tabs: { flexDirection: "row", backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.red },
  tabText: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
  tabTextActive: { color: colors.navy },
});
