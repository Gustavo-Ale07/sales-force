import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BackHandler, KeyboardAvoidingView, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { useConnectivity } from "../connectivity/use-connectivity";
import type { Account } from "../auth/auth-port";
import type { AppDependencies } from "../dependencies";
import type { CustomerListItem } from "../data/ports";
import { evaluateOfflineAccess } from "../offline/session";
import { useSyncStatus } from "../offline/use-sync";
import { colors, spacing } from "../theme";
import { BottomNav, type MainTab } from "./bottom-nav";
import { BrandLogo, SplashView } from "./brand";
import { CustomerDetailScreen } from "./customer-detail-screen";
import { CustomersScreen } from "./customers-screen";
import { DraftsScreen } from "./drafts-screen";
import { HomeScreen } from "./home-screen";
import { LoginScreen } from "./login-screen";
import { NewOrderScreen } from "./new-order-screen";
import { ProductsScreen } from "./products-screen";
import { ProfileScreen } from "./profile-screen";
import { HeaderSyncStatus } from "./sync-status";
import { useInsets } from "./use-insets";
import { useKeyboardVisible } from "./use-keyboard-visible";

type Session =
  | { readonly phase: "checking" }
  | { readonly phase: "anonymous" }
  | { readonly phase: "authenticated"; readonly account: Account; readonly offlineEntry: boolean };
type SalesView = "orders" | "newOrder";

/** Offline banner: lists and drafts come from the encrypted database on this device (MOB-6). */
export function OfflineNotice({ message = "Sem conexão. Exibindo os dados salvos neste aparelho." }: { message?: string }) {
  return (
    <View style={styles.offlineNotice} accessibilityRole="alert">
      <Text style={styles.offlineText}>{message}</Text>
    </View>
  );
}

/**
 * A tab body. It mounts on first visit and then stays mounted (hidden), so a cart, a scroll position or a
 * half-typed search survive moving between tabs.
 */
function Pane({ active, visited, children }: { active: boolean; visited: boolean; children: ReactNode }) {
  if (!visited) return null;
  return <View style={active ? styles.paneActive : styles.paneHidden}>{children}</View>;
}

/** Session gate + the signed-in shell (header, tab bodies, bottom navigation). Everything comes through `dependencies` (ports). */
export function Shell({ dependencies }: { dependencies: AppDependencies }) {
  const { auth, connectivity, offline } = dependencies;
  const insets = useInsets();
  const keyboardVisible = useKeyboardVisible();
  const [session, setSession] = useState<Session>({ phase: "checking" });
  const [tab, setTab] = useState<MainTab>("home");
  const [visited, setVisited] = useState<ReadonlySet<MainTab>>(() => new Set<MainTab>(["home"]));
  const [salesView, setSalesView] = useState<SalesView>("orders");
  const [resumeLocalId, setResumeLocalId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerListItem | null>(null);
  const [startRequest, setStartRequest] = useState<{ nonce: number; customer: Pick<CustomerListItem, "code" | "name"> } | null>(null);
  const connectivityState = useConnectivity(connectivity);
  const account = session.phase === "authenticated" ? session.account : null;
  // One set of services per signed-in account: cache-backed reads, local drafts and the sync manager.
  const services = useMemo(() => (account !== null && offline !== undefined ? offline.forAccount(account) : null), [account, offline]);
  const repositories = services?.repositories ?? dependencies.repositories;
  const syncStatus = useSyncStatus(services?.sync ?? null, connectivityState);
  const clearResume = useCallback(() => setResumeLocalId(null), []);
  const clearStart = useCallback(() => setStartRequest(null), []);
  const inDetail = customerDetail !== null && tab === "customers";
  // Hardware back closes the customer sheet before anything else.
  useEffect(() => {
    if (!inDetail) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setCustomerDetail(null);
      return true;
    });
    return () => subscription.remove();
  }, [inDetail]);
  const syncNow = useCallback(() => {
    void services?.sync.sync("manual");
  }, [services]);

  const selectTab = useCallback((next: MainTab) => {
    setTab(next);
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
  }, []);

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
        setSession({ phase: "authenticated", account: found, offlineEntry: false });
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
        if (active) setSession(access.allowed ? { phase: "authenticated", account: access.session.account, offlineEntry: true } : { phase: "anonymous" });
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
    setTab("home");
    setVisited(new Set<MainTab>(["home"]));
    setSalesView("orders");
    setCustomerDetail(null);
    setStartRequest(null);
    setSession({ phase: "anonymous" });
  }

  if (session.phase === "checking") return <SplashView />;

  if (session.phase === "anonymous") {
    return (
      <LoginScreen
        auth={auth}
        connectivity={connectivityState}
        onAuthenticated={(signedIn) => {
          void offline?.session.remember(signedIn).catch(() => undefined);
          setSession({ phase: "authenticated", account: signedIn, offlineEntry: false });
        }}
      />
    );
  }

  const openDraft = (localId: string) => {
    setResumeLocalId(localId);
    setSalesView("newOrder");
    selectTab("sales");
  };
  const startOrderFor = (picked: CustomerListItem) => {
    setStartRequest({ nonce: Date.now(), customer: { code: picked.code, name: picked.name } });
    setSalesView("newOrder");
    selectTab("sales");
  };
  const syncView = { status: syncStatus, connectivity: connectivityState, onSyncNow: syncNow };

  return (
    <View style={styles.flex}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <BrandLogo height={26} />
        <View style={styles.headerSpacer} />
        {services !== null && <HeaderSyncStatus {...syncView} />}
      </View>
      {connectivityState === "offline" && (
        <OfflineNotice
          message={session.offlineEntry ? "Modo offline: você entrou com a sessão salva neste aparelho." : "Sem conexão. Exibindo os dados salvos neste aparelho."}
        />
      )}
      {/* Android is edge-to-edge: the window no longer resizes for the keyboard, so the body avoids it itself. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.flex}>
          <Pane active={tab === "home"} visited={visited.has("home")}>
            <HomeScreen
              account={session.account}
              active={tab === "home"}
              repositories={repositories}
              localOrders={services?.localOrders ?? null}
              syncStatus={syncStatus}
              connectivity={connectivityState}
              onNewOrder={() => {
                setSalesView("newOrder");
                selectTab("sales");
              }}
              onResumeDraft={openDraft}
              {...(services === null ? {} : { onSyncNow: syncNow })}
            />
          </Pane>
          <Pane active={tab === "customers"} visited={visited.has("customers")}>
            <View style={customerDetail === null ? styles.paneActive : styles.paneHidden}>
              <CustomersScreen customers={repositories.customers} onUnauthenticated={expire} connectivity={connectivityState} onOpen={setCustomerDetail} />
            </View>
            {customerDetail !== null && (
              <CustomerDetailScreen
                customer={customerDetail}
                customers={repositories.customers}
                connectivity={connectivityState}
                onBack={() => setCustomerDetail(null)}
                onNewOrder={startOrderFor}
              />
            )}
          </Pane>
          <Pane active={tab === "sales"} visited={visited.has("sales")}>
            {services !== null && (
              <View style={styles.segments} accessibilityRole="tablist">
                {(["orders", "newOrder"] as const).map((key) => (
                  <Pressable
                    key={key}
                    style={[styles.segment, salesView === key && styles.segmentActive]}
                    onPress={() => setSalesView(key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: salesView === key }}
                  >
                    <Text style={[styles.segmentText, salesView === key && styles.segmentTextActive]}>{key === "orders" ? "Pedidos" : "Novo pedido"}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={salesView === "newOrder" || services === null ? styles.paneActive : styles.paneHidden}>
              <NewOrderScreen
                repositories={repositories}
                onUnauthenticated={expire}
                {...(services === null ? {} : { localOrders: services.localOrders, resumeLocalId, onResumeConsumed: clearResume })}
                startRequest={startRequest}
                onStartConsumed={clearStart}
              />
            </View>
            {services !== null && (
              <View style={salesView === "orders" ? styles.paneActive : styles.paneHidden}>
                <DraftsScreen localOrders={services.localOrders} syncStatus={syncStatus} onOpen={openDraft} />
              </View>
            )}
          </Pane>
          <Pane active={tab === "catalog"} visited={visited.has("catalog")}>
            <ProductsScreen products={repositories.products} onUnauthenticated={expire} />
          </Pane>
          <Pane active={tab === "profile"} visited={visited.has("profile")}>
            <ProfileScreen
              account={session.account}
              {...syncView}
              {...(services === null
                ? {}
                : {
                    onOpenLocalOrders: () => {
                      setSalesView("orders");
                      selectTab("sales");
                    },
                  })}
              onSignOut={() => void signOut()}
            />
          </Pane>
        </View>
        {!keyboardVisible && <BottomNav active={tab} onSelect={selectTab} badges={{ sales: syncStatus.pending > 0 || syncStatus.needsAttention > 0 }} />}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  paneActive: { flex: 1 },
  paneHidden: { display: "none" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerSpacer: { flex: 1 },
  offlineNotice: { backgroundColor: colors.errorBackground, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  offlineText: { color: colors.text, fontSize: 13 },
  segments: { flexDirection: "row", backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  segment: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 3, borderBottomColor: "transparent" },
  segmentActive: { borderBottomColor: colors.red },
  segmentText: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
  segmentTextActive: { color: colors.navy },
});
