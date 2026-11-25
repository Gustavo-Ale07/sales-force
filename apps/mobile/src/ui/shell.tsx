import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, KeyboardAvoidingView, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { useConnectivity } from "../connectivity/use-connectivity";
import type { Account } from "../auth/auth-port";
import type { AppDependencies } from "../dependencies";
import type { CustomerListItem } from "../data/ports";
import { lineFromProduct, type EditorLine } from "../data/order-draft";
import { ProductImageProvider } from "../images/product-image-context";
import { evaluateOfflineAccess } from "../offline/session";
import { useSyncStatus } from "../offline/use-sync";
import { colors, HEADER_HEIGHT, spacing } from "../theme";
import { AppModalProvider } from "./app-modal";
import { ErrorActionsContext, useErrorPopup } from "./use-error-popup";
import { BottomNav, type MainTab } from "./bottom-nav";
import { BrandLogo, SplashView } from "./brand";
import { CustomerDetailScreen } from "./customer-detail-screen";
import { CustomerCreateScreen } from "./customer-create-screen";
import { useIcmsOptions } from "../data/icms-options";
import { useSellerChoices } from "./use-seller-choices";
import { CustomerEditScreen } from "./customer-edit-screen";
import { OrderTemplateFormScreen } from "./order-template-form-screen";
import { OrderTemplatesSection } from "./order-templates-section";
import { CustomersScreen } from "./customers-screen";
import { SalesScreen } from "./sales-screen";
import { HomeScreen } from "./home-screen";
import { LoginScreen } from "./login-screen";
import { NewOrderScreen, type NewOrderControl } from "./new-order-screen";
import { ExitHint } from "./exit-hint";
import { EXIT_WINDOW_MS, resolveBack, type BackState } from "./back-navigation";
import { ProductsScreen } from "./products-screen";
import { installUpdate, updateAvailable } from "../update/device-update";
import { ProfileScreen } from "./profile-screen";
import { Avatar, useProfilePhotoUri } from "./avatar";
import { QuarantineScreen } from "./quarantine-screen";
import { HeaderSyncStatus } from "./sync-status";
import { SyncProgressOverlay } from "./sync-progress-overlay";
import { useInsets } from "./use-insets";
import { useKeyboardVisible } from "./use-keyboard-visible";

type Session =
  | { readonly phase: "checking" }
  | { readonly phase: "anonymous" }
  | { readonly phase: "authenticated"; readonly account: Account; readonly offlineEntry: boolean; /** Came from the login screen (not a reopened session). */ readonly freshLogin?: boolean };
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
  return (
    <AppModalProvider>
      <ShellBody dependencies={dependencies} />
    </AppModalProvider>
  );
}

function ShellBody({ dependencies }: { dependencies: AppDependencies }) {
  const { auth, connectivity, offline } = dependencies;
  const errors = useErrorPopup();
  const insets = useInsets();
  const keyboardVisible = useKeyboardVisible();
  const [session, setSession] = useState<Session>({ phase: "checking" });
  const [tab, setTab] = useState<MainTab>("home");
  const [visited, setVisited] = useState<ReadonlySet<MainTab>>(() => new Set<MainTab>(["home"]));
  const [salesView, setSalesView] = useState<SalesView>("orders");
  const [salesReset, setSalesReset] = useState(0);
  /** Bumped when an order's number or stage was refreshed behind the list (post-confirmation follow-up). */
  const [salesRefresh, setSalesRefresh] = useState(0);
  /** "Ver pedido" on the post-confirmation screen: the sales list opens this order's detail once per `nonce`. */
  const [openSaleRequest, setOpenSaleRequest] = useState<{ localId: string; nonce: number } | null>(null);
  /** Bumped when a tab is left: its screen remounts on its initial screen (nothing of it is kept). */
  const [epochs, setEpochs] = useState<Readonly<Record<MainTab, number>>>({ home: 0, customers: 0, sales: 0, catalog: 0, profile: 0 });
  const [saleDetailOpen, setSaleDetailOpen] = useState(false);
  const [exitHint, setExitHint] = useState(false);
  const exitArmedAt = useRef<number | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orderControl = useRef<NewOrderControl | null>(null);
  const [resumeLocalId, setResumeLocalId] = useState<string | null>(null);
  const [quarantineOpen, setQuarantineOpen] = useState(false);
  const [quarantinedCount, setQuarantinedCount] = useState(0);
  const [quarantineTick, setQuarantineTick] = useState(0);
  const [customerDetail, setCustomerDetail] = useState<CustomerListItem | null>(null);
  /** The customer form open over the Clientes tab; one at a time. */
  const [customerForm, setCustomerForm] = useState<{ kind: "create" } | { kind: "edit"; customer: CustomerListItem } | { kind: "template"; customer: CustomerListItem } | null>(null);
  const [customerFlags, setCustomerFlags] = useState({ create: false, edit: false });
  const [startRequest, setStartRequest] = useState<{ nonce: number; customer: Pick<CustomerListItem, "code" | "name">; lines?: readonly EditorLine[] } | null>(null);
  const connectivityState = useConnectivity(connectivity);
  const account = session.phase === "authenticated" ? session.account : null;
  // One set of services per signed-in account: cache-backed reads, local drafts and the sync manager.
  const photoService = dependencies.profilePhoto;
  const photoUri = useProfilePhotoUri(photoService?.store, account?.id ?? "", account?.photoVersion, connectivityState !== "offline");
  const services = useMemo(() => (account !== null && offline !== undefined ? offline.forAccount(account) : null), [account, offline]);
  const repositories = services?.repositories ?? dependencies.repositories;
  const icmsOptions = useIcmsOptions();
  const customerWriter = dependencies.customerWrite;
  const loadActiveSellers = useMemo(() => (customerWriter?.activeSellers === undefined ? undefined : () => customerWriter.activeSellers!()), [customerWriter]);
  const customerRepository = repositories.customers;
  const loadLocalSellers = useMemo(() => (customerRepository.sellers === undefined ? undefined : () => customerRepository.sellers!()), [customerRepository]);
  const sellerChoices = useSellerChoices({
    isSeller: (account?.sellerCodes.length ?? 0) > 0,
    enabled: customerForm?.kind === "create" || customerDetail?.pending?.needsSeller === true,
    ...(loadActiveSellers === undefined ? {} : { loadActive: loadActiveSellers }),
    ...(loadLocalSellers === undefined ? {} : { loadLocal: loadLocalSellers }),
  });
  // RT-1: opening the orders list or one order's detail asks the server to re-read the open orders (cap and cooldown in the engine).
  const ordersAreaKey = tab === "sales" && salesView === "orders" ? `orders:${saleDetailOpen}` : undefined;
  const syncStatus = useSyncStatus(services?.sync ?? null, connectivityState, session.phase === "authenticated" && session.freshLogin === true, services?.openEvents, ordersAreaKey);
  const clearResume = useCallback(() => setResumeLocalId(null), []);
  const clearStart = useCallback(() => setStartRequest(null), []);
  // Retained (quarantined) orders: re-counted whenever the sync counters move or the seller changes them.
  const localOrdersForCount = services?.localOrders ?? null;
  useEffect(() => {
    if (localOrdersForCount === null) return undefined;
    let current = true;
    localOrdersForCount
      .countQuarantined()
      .then((count) => current && setQuarantinedCount(count))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [localOrdersForCount, syncStatus.needsAttention, syncStatus.pending, syncStatus.phase, quarantineTick]);
  // Entry points of the customer forms follow the flags of the last sync (re-read whenever a sync moves).
  const pendingCustomers = services?.pendingCustomers ?? null;
  useEffect(() => {
    if (pendingCustomers === null) return undefined;
    let current = true;
    void Promise.all([pendingCustomers.creationAvailable(), pendingCustomers.editAvailable?.() ?? Promise.resolve(false)])
      .then(([create, edit]) => current && setCustomerFlags({ create, edit }))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [pendingCustomers, syncStatus.phase, syncStatus.pending, syncStatus.needsAttention]);
  const closeQuarantine = useCallback(() => setQuarantineOpen(false), []);
  const quarantineChanged = useCallback(() => setQuarantineTick((n) => n + 1), []);
  const syncNow = useCallback(() => {
    void services?.sync.sync("manual");
  }, [services]);
  const cancelSync = useCallback(() => {
    services?.sync.cancel?.();
  }, [services]);

  const tabRef = useRef<MainTab>(tab);
  tabRef.current = tab;
  /** Leaving a tab closes whatever was open in it: the next visit starts on its initial screen. */
  const resetTab = useCallback((left: MainTab) => {
    setEpochs((current) => ({ ...current, [left]: current[left] + 1 }));
    if (left === "customers") {
      setCustomerDetail(null);
      setCustomerForm(null);
    }
    if (left === "sales") {
      setSalesView("orders");
      setSaleDetailOpen(false);
    }
    if (left === "profile") setQuarantineOpen(false);
  }, []);
  const selectTab = useCallback(
    (next: MainTab) => {
      const left = tabRef.current;
      const show = () => {
        setTab(next);
        setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
      };
      if (next === left) {
        show();
        return;
      }
      const order = left === "sales" ? orderControl.current : null;
      if (order === null) {
        resetTab(left);
        show();
        return;
      }
      // An order with unsaved content asks first ("Descartar o pedido?"); the tab changes only once the wizard closed (saved or discarded).
      void order.requestLeave().then((closed) => {
        if (!closed) return;
        resetTab(left);
        show();
      });
    },
    [resetTab],
  );

  // Android Back: ONE resolver (back-navigation.ts) decides; this only carries out its answer.
  const syncOverlayOn = syncStatus.phase === "syncing" && (syncStatus.steps ?? null) !== null;
  const backState = useRef<Omit<BackState, "now">>({ overlay: "none", tab, wizardOpen: false, saleDetailOpen: false, customerDetailOpen: false, exitArmedAt: null });
  backState.current = {
    overlay: syncOverlayOn ? "sync" : quarantineOpen ? "quarantine" : "none",
    tab,
    wizardOpen: salesView === "newOrder",
    saleDetailOpen,
    customerDetailOpen: customerDetail !== null,
    exitArmedAt: exitArmedAt.current,
  };
  const authenticated = session.phase === "authenticated";
  useEffect(() => {
    if (!authenticated) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const now = Date.now();
      const action = resolveBack({ ...backState.current, exitArmedAt: exitArmedAt.current, now });
      switch (action.type) {
        case "ignore":
          break;
        case "close_quarantine":
          setQuarantineOpen(false);
          break;
        case "wizard_back":
          orderControl.current?.back();
          break;
        case "close_customer_detail":
          setCustomerDetail(null);
          break;
        case "close_sale_detail":
          setSalesReset((n) => n + 1);
          setSaleDetailOpen(false);
          break;
        case "go_home":
          selectTab("home");
          break;
        case "arm_exit":
          exitArmedAt.current = now;
          setExitHint(true);
          if (exitTimer.current !== null) clearTimeout(exitTimer.current);
          exitTimer.current = setTimeout(() => {
            exitArmedAt.current = null;
            setExitHint(false);
          }, EXIT_WINDOW_MS);
          break;
        case "exit_app":
          BackHandler.exitApp();
          break;
      }
      return true;
    });
    return () => subscription.remove();
  }, [authenticated, selectTab]);
  useEffect(
    () => () => {
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    },
    [],
  );

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

  /** The photo changed or was removed: the session account carries the new version (the remembered offline record is not touched). */
  const photoChanged = useCallback((version: string | null) => {
    setSession((current) => (current.phase === "authenticated" ? { ...current, account: { ...current.account, photoVersion: version } } : current));
  }, []);

  const expire = useCallback(() => setSession({ phase: "anonymous" }), []);
  // Fixing actions every error popup can offer: the sync panel lives in Perfil; an expired session goes back to sign-in.
  const errorActions = useMemo(() => ({ go_sync: () => selectTab("profile"), sign_in: expire }), [selectTab, expire]);

  /**
   * Explicit sign-out. A failed server logout is never swallowed: the session may still be valid on the server, so the
   * seller is told and STAYS signed in (retry or cancel). There is deliberately no "leave anyway" path: it would look like
   * a sign-out while the server session is still open. Drafts and the outbox are never deleted by
   * a sign-out; the downloaded cache is cleared only when nothing is unsent (owner 2026-11-13).
   */
  async function signOut() {
    try {
      await auth.logout();
    } catch (error) {
      // The session may still be open on the server: say so, keep the seller signed in, offer to retry.
      errors.report(
        error,
        { retry: () => void signOut() },
        {
          title: "Não foi possível sair",
          message: "Sua sessão no servidor pode continuar aberta. Tente de novo com internet. Seus pedidos salvos não serão apagados.",
        },
      );
      return;
    }
    await leaveDevice();
  }

  async function leaveDevice() {
    // Forget the remembered account; drafts and unsent orders stay on the device for the next sign-in.
    await offline?.session.forget().catch(() => undefined);
    // Nothing unsent: the downloaded cache goes too. Something unsent: everything stays, isolated per account (the warning was shown before).
    if (account !== null) await offline?.endSession(account.id).catch(() => undefined);
    // Thumbnails are a cache of the signed-in account's catalog: gone with the sign-out (they are re-fetchable).
    await services?.productImages?.purge().catch(() => undefined);
    await photoService?.store.purge().catch(() => undefined);
    setQuarantineOpen(false);
    setTab("home");
    setVisited(new Set<MainTab>(["home"]));
    setSalesView("orders");
    setCustomerDetail(null);
    setCustomerForm(null);
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
          setSession({ phase: "authenticated", account: signedIn, offlineEntry: false, freshLogin: true });
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
  /** Duplicate: a new order with the same customer and items at today's list price; never the same identifiers (the save makes new ones). */
  const duplicateSale = (localId: string) => {
    const local = services?.localOrders;
    if (local === undefined) return;
    void (async () => {
      try {
        const opened = await local.open(localId);
        if (opened === null) return;
        const lines = await Promise.all(
          opened.lines.map(async (line, index) => {
            try {
              const product = await repositories.products.get(line.productCode);
              return { ...lineFromProduct(product, `copy-${index}`), quantityText: line.quantityText };
            } catch {
              // Product not in this device's catalog any more: keep the line without a price ("Sem preço"), never the old one.
              return { ...line, key: `copy-${index}`, discountText: "", price: { state: "none" as const, tableCode: null, versionId: null, noPriceReason: "no_price_row" as const } };
            }
          }),
        );
        setStartRequest({ nonce: Date.now(), customer: { code: opened.draft.customerCode, name: opened.draft.customerName }, lines });
        setSalesView("newOrder");
        selectTab("sales");
      } catch (error) {
        errors.report(error, { retry: () => duplicateSale(localId) }, { title: "Não foi possível duplicar" });
      }
    })();
  };
  const syncView = {
    status: syncStatus,
    connectivity: connectivityState,
    onSyncNow: syncNow,
    ...(services === null ? {} : { quarantinedCount, onOpenQuarantine: () => setQuarantineOpen(true) }),
  };

  return (
    <View style={styles.flex}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_HEIGHT }]}>
        <BrandLogo height={24} />
        <View style={styles.headerSpacer} />
        {services !== null && <HeaderSyncStatus {...syncView} />}
        <Pressable onPress={() => selectTab("profile")} accessibilityRole="button" accessibilityLabel="Abrir perfil" hitSlop={8} testID="header-avatar">
          <Avatar name={session.account.displayName} size={32} uri={photoUri} onNavy />
        </Pressable>
      </View>
      {connectivityState === "offline" && (
        <OfflineNotice
          message={session.offlineEntry ? "Modo offline: você entrou com a sessão salva neste aparelho." : "Sem conexão. Exibindo os dados salvos neste aparelho."}
        />
      )}
      {/* Android is edge-to-edge: the window no longer resizes for the keyboard, so the body avoids it itself. */}
      <ErrorActionsContext.Provider value={errorActions}>
      <SyncProgressOverlay status={syncStatus} onRetry={syncNow} {...(services?.sync.cancel === undefined ? {} : { onCancel: cancelSync })} />
      <ProductImageProvider store={services?.productImages ?? null} online={connectivityState !== "offline"}>
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
              {...(dependencies.dashboard !== undefined ? { dashboard: dependencies.dashboard } : {})}
              {...(services === null ? {} : { onSyncNow: syncNow })}
            />
          </Pane>
          <Pane active={tab === "customers"} visited={visited.has("customers")}>
            <View style={customerDetail === null && customerForm === null ? styles.paneActive : styles.paneHidden}>
              <CustomersScreen
                key={epochs.customers}
                customers={repositories.customers}
                onUnauthenticated={expire}
                connectivity={connectivityState}
                onOpen={setCustomerDetail}
                {...(dependencies.dashboard !== undefined ? { dashboard: dependencies.dashboard } : {})}
                {...(customerFlags.create && pendingCustomers !== null ? { onCreate: () => setCustomerForm({ kind: "create" }) } : {})}
              />
            </View>
            {customerDetail !== null && customerForm === null && (
              <CustomerDetailScreen
                customer={customerDetail}
                customers={repositories.customers}
                connectivity={connectivityState}
                onBack={() => setCustomerDetail(null)}
                onNewOrder={startOrderFor}
                {...(pendingCustomers !== null && sellerChoices !== null && customerDetail.pending?.needsSeller === true
                  ? {
                      sellers: sellerChoices,
                      onAssignSeller: async (sellerCode: number) => {
                        await pendingCustomers.assignSeller(customerDetail.pending!.clientRequestId, sellerCode);
                        setCustomerDetail((current) => (current === null || current.pending === undefined ? current : { ...current, sellerCode, pending: { ...current.pending, needsSeller: false } }));
                      },
                    }
                  : {})}
                {...(services?.localOrders !== undefined ? { localOrders: services.localOrders, onRepeatLast: (localId: string) => { setCustomerDetail(null); duplicateSale(localId); } } : {})}
                {...(customerFlags.edit && dependencies.customerWrite !== undefined ? { onEdit: (picked: CustomerListItem) => setCustomerForm({ kind: "edit", customer: picked }) } : {})}
                {...(dependencies.orderTemplates !== undefined
                  ? {
                      templatesSection: (
                        <OrderTemplatesSection
                          customerCode={customerDetail.code}
                          templates={dependencies.orderTemplates}
                          products={repositories.products}
                          orders={repositories.orders}
                          onCreate={() => setCustomerForm({ kind: "template", customer: customerDetail })}
                          onUse={(lines) => {
                            setStartRequest({ nonce: Date.now(), customer: { code: customerDetail.code, name: customerDetail.name }, lines });
                            setCustomerDetail(null);
                            setSalesView("newOrder");
                            selectTab("sales");
                          }}
                        />
                      ),
                    }
                  : {})}
              />
            )}
            {customerForm?.kind === "create" && pendingCustomers !== null && (
              <CustomerCreateScreen
                icmsOptions={icmsOptions}
                sellers={sellerChoices}
                onSave={async (request) => {
                  const result = await pendingCustomers.submit(request, { online: connectivityState !== "offline" });
                  setCustomerForm(null);
                  setEpochs((current) => ({ ...current, customers: current.customers + 1 }));
                  // Created at once: its ficha opens with the Sankhya code. Pending: back to the list, which shows the discreet indicator.
                  if (result.kind === "sent") {
                    setCustomerDetail({
                      code: result.customerCode,
                      name: request.name,
                      tradeName: request.tradeName,
                      document: null,
                      active: true,
                      blocked: false,
                      sellerCode: request.sellerCode ?? account?.sellerCodes[0] ?? null,
                      sellerName: null,
                      priceTableCode: null,
                    });
                  }
                }}
                onClose={() => {
                  setCustomerForm(null);
                  setEpochs((current) => ({ ...current, customers: current.customers + 1 }));
                }}
              />
            )}
            {customerForm?.kind === "template" && dependencies.orderTemplates !== undefined && (
              <OrderTemplateFormScreen
                customerCode={customerForm.customer.code}
                customerName={customerForm.customer.name}
                templates={dependencies.orderTemplates}
                products={repositories.products}
                orders={repositories.orders}
                onUnauthenticated={expire}
                onSaved={() => setCustomerForm(null)}
                onClose={() => setCustomerForm(null)}
              />
            )}
            {customerForm?.kind === "edit" && dependencies.customerWrite !== undefined && (
              <CustomerEditScreen
                customerName={customerForm.customer.name}
                code={customerForm.customer.code}
                writer={dependencies.customerWrite}
                connectivity={connectivityState}
                onClose={() => setCustomerForm(null)}
              />
            )}
          </Pane>
          <Pane active={tab === "sales"} visited={visited.has("sales")}>
            {(salesView === "newOrder" || services === null) && (
            <View style={styles.paneActive}>
              <NewOrderScreen
                controlRef={orderControl}
                repositories={repositories}
                onUnauthenticated={expire}
                {...(services === null
                  ? {}
                  : {
                      localOrders: services.localOrders,
                      resumeLocalId,
                      onResumeConsumed: clearResume,
                      onExit: () => {
                        setSalesView("orders");
                        setSalesReset((n) => n + 1);
                      },
                      onViewOrder: (localId: string) => {
                        // The read-only detail of the confirmed order, inside the sales list.
                        setOpenSaleRequest({ localId, nonce: Date.now() });
                        setSalesView("orders");
                        setSalesReset((n) => n + 1);
                      },
                      onGoHome: () => selectTab("home"),
                      onOrderUpdated: () => setSalesRefresh((n) => n + 1),
                    })}
                startRequest={startRequest}
                onStartConsumed={clearStart}
              />
            </View>
            )}
            {services !== null && (
              <View style={salesView === "orders" ? styles.paneActive : styles.paneHidden}>
                <SalesScreen
                  key={epochs.sales}
                  onDetailChange={setSaleDetailOpen}
                  localOrders={services.localOrders}
                  customers={repositories.customers}
                  products={repositories.products}
                  orders={repositories.orders}
                  {...(dependencies.orderPdf !== undefined ? { orderPdf: dependencies.orderPdf } : {})}
                  syncStatus={syncStatus}
                  connectivity={connectivityState}
                  onUnauthenticated={expire}
                  onNewSale={() => setSalesView("newOrder")}
                  onContinue={openDraft}
                  onDuplicate={duplicateSale}
                  onSyncNow={syncNow}
                  resetSignal={salesReset}
                  refreshSignal={salesRefresh}
                  openRequest={openSaleRequest}
                />
              </View>
            )}
          </Pane>
          <Pane active={tab === "catalog"} visited={visited.has("catalog")}>
            <ProductsScreen key={epochs.catalog} products={repositories.products} onUnauthenticated={expire} connectivity={connectivityState} />
          </Pane>
          <Pane active={tab === "profile"} visited={visited.has("profile")}>
            <ProfileScreen
              key={epochs.profile}
              account={session.account}
              {...syncView}
              {...(photoService === undefined ? {} : { photo: { service: photoService, uri: photoUri, onChanged: photoChanged } })}
              {...(updateAvailable ? { onCheckUpdate: installUpdate } : {})}
              onSignOut={() => void signOut()}
              {...(account !== null && offline !== undefined ? { loadUnsent: () => offline.unsentWork(account.id) } : {})}
            />
          </Pane>
          {quarantineOpen && services !== null && (
            <View style={styles.overlay}>
              <QuarantineScreen localOrders={services.localOrders} onBack={closeQuarantine} onChanged={quarantineChanged} />
            </View>
          )}
        </View>
        {exitHint && <ExitHint bottom={(keyboardVisible ? 0 : 56 + insets.bottom) + spacing.md} />}
        {!keyboardVisible && <BottomNav active={tab} onSelect={selectTab} badges={{ sales: syncStatus.awaitingOrders ?? 0 }} />}
      </KeyboardAvoidingView>
      </ProductImageProvider>
      </ErrorActionsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  paneActive: { flex: 1 },
  paneHidden: { display: "none" },
  overlay: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
  },
  headerSpacer: { flex: 1 },
  offlineNotice: { backgroundColor: colors.errorBackground, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  offlineText: { color: colors.text, fontSize: 13 },
});
