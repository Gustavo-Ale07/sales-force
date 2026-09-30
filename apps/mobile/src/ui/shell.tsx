import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useConnectivity } from "../connectivity/use-connectivity";
import type { Account } from "../auth/auth-port";
import type { AppDependencies } from "../dependencies";
import { evaluateOfflineAccess } from "../offline/session";
import { useSyncStatus } from "../offline/use-sync";
import { colors, spacing } from "../theme";
import { ConnectivityBadge } from "./connectivity-badge";
import { CustomersScreen } from "./customers-screen";
import { DraftsScreen } from "./drafts-screen";
import { LoginScreen } from "./login-screen";
import { NewOrderScreen } from "./new-order-screen";
import { ProductsScreen } from "./products-screen";
import { SyncIndicator } from "./sync-indicator";

type Session = { readonly phase: "checking" } | { readonly phase: "anonymous" } | { readonly phase: "authenticated"; readonly account: Account };
type Tab = "customers" | "products" | "newOrder" | "drafts";

const TAB_LABEL: Record<Tab, string> = { customers: "Clientes", products: "Catálogo", newOrder: "Novo pedido", drafts: "Pedidos" };

/** Offline banner: lists and drafts come from the encrypted database on this device (MOB-6). */
export function OfflineNotice() {
  return (
    <View style={styles.offlineNotice} accessibilityRole="alert">
      <Text style={styles.offlineText}>Sem conexão. Exibindo os dados salvos neste aparelho.</Text>
    </View>
  );
}

/** Session gate + the two read-only lists. Everything it touches comes through `dependencies` (ports). */
export function Shell({ dependencies }: { dependencies: AppDependencies }) {
  const { auth, connectivity, offline } = dependencies;
  const [session, setSession] = useState<Session>({ phase: "checking" });
  const [tab, setTab] = useState<Tab>("customers");
  const [resumeLocalId, setResumeLocalId] = useState<string | null>(null);
  const connectivityState = useConnectivity(connectivity);
  const account = session.phase === "authenticated" ? session.account : null;
  // One set of services per signed-in account: cache-backed reads, local drafts and the sync manager.
  const services = useMemo(() => (account !== null && offline !== undefined ? offline.forAccount(account) : null), [account, offline]);
  const repositories = services?.repositories ?? dependencies.repositories;
  const syncStatus = useSyncStatus(services?.sync ?? null, connectivityState);
  const clearResume = useCallback(() => setResumeLocalId(null), []);
  useEffect(() => {
    let active = true;
    auth
      .getSession()
      .then((found) => {
        if (!active) return;
        if (found === null) {
          setSession({ phase: "anonymous" });
          return;
        }
        // Online authentication: remember the account (non-secret fields) for the offline gate.
        void offline?.session.remember(found).catch(() => undefined);
        setSession({ phase: "authenticated", account: found });
      })
      .catch(async () => {
        // Could not reach the server. With a remembered account inside the offline window the seller keeps working
        // on the local data (AUTH-2 PROPOSED: 7 days); otherwise show the login form, which reports the real problem.
        let access: ReturnType<typeof evaluateOfflineAccess> = { allowed: false, reason: "none" };
        try {
          access = evaluateOfflineAccess((await offline?.session.load()) ?? null, new Date());
        } catch {
          // an unreadable remembered session is the same as none
        }
        if (active) setSession(access.allowed ? { phase: "authenticated", account: access.session.account } : { phase: "anonymous" });
      });
    return () => {
      active = false;
    };
  }, [auth, offline]);

  const expire = useCallback(() => setSession({ phase: "anonymous" }), []);

  async function signOut() {
    try {
      await auth.logout();
    } catch {
      // The server session may outlive a failed call, but the screen must not keep showing private data.
    }
    // Forget the remembered account; drafts and unsent orders stay on the device for the next sign-in.
    await offline?.session.forget().catch(() => undefined);
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
        <LoginScreen auth={auth} onAuthenticated={(signedIn) => {
            void offline?.session.remember(signedIn).catch(() => undefined);
            setSession({ phase: "authenticated", account: signedIn });
          }} />
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
      {services !== null && <SyncIndicator status={syncStatus} connectivity={connectivityState} onRetry={() => void services.sync.sync("manual")} />}
      {connectivityState === "offline" && <OfflineNotice />}
      <View style={styles.tabs} accessibilityRole="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).filter((key) => key !== "drafts" || services !== null).map((key) => (
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
      {tab === "newOrder" && (
        <NewOrderScreen
          repositories={repositories}
          onUnauthenticated={expire}
          {...(services === null ? {} : { localOrders: services.localOrders, resumeLocalId, onResumeConsumed: clearResume })}
        />
      )}
      {tab === "drafts" && services !== null && (
        <DraftsScreen
          localOrders={services.localOrders}
          syncStatus={syncStatus}
          onOpen={(localId) => {
            setResumeLocalId(localId);
            setTab("newOrder");
          }}
        />
      )}
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
