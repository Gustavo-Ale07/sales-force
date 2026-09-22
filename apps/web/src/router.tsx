import type { QueryClient } from "@tanstack/react-query";
import { canSeeIntegration } from "@salesforce/contracts";
import { toast } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  useRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import { NotFound, RouteError, RoutePending } from "./components/route-states";
import { useAppServices } from "./lib/app-context";
import { sessionQueryOptions, type AuthClient } from "./lib/auth-client";
import { parseCustomersSearch, parseOrdersSearch, parseProductsSearch } from "./lib/route-search";
import { safeRedirect } from "./lib/safe-redirect";
import { asInt } from "./lib/search-params";
import { LoginPage } from "./routes/login";

export interface RouterContext {
  queryClient: QueryClient;
  authClient: AuthClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  // Fallback outside the shell (e.g. a missing parent segment); normal unknown URLs hit `notFoundRoute` below.
  notFoundComponent: () => (
    <main id="conteudo" className="mx-auto max-w-lg p-6">
      <NotFound />
    </main>
  ),
});

/** Pathless layout: requires a session, renders the AppShell. The server re-checks every request. */
function AuthenticatedLayout() {
  const { authClient } = useAppServices();
  const queryClient = useQueryClient();
  const router = useRouter();
  const session = useQuery(sessionQueryOptions(authClient));
  const logout = useMutation({
    mutationFn: () => authClient.logout(),
    onSuccess: async () => {
      queryClient.clear();
      await router.navigate({ to: "/login" });
    },
    // The session may still be valid: stay signed in and say so instead of pretending to have left.
    onError: () => toast({ title: "Não foi possível encerrar a sessão", description: "Tente novamente.", tone: "danger" }),
  });
  return (
    <AppShell user={session.data ?? null} onLogout={() => logout.mutate()}>
      <Outlet />
    </AppShell>
  );
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: AuthenticatedLayout,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient));
    if (!user) {
      throw redirect({ to: "/login", search: { redirect: safeRedirect(location.href) } });
    }
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  staticData: { crumb: "Entrar" },
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = safeRedirect(search.redirect);
    return target ? { redirect: target } : {};
  },
  beforeLoad: async ({ context, search }) => {
    // Already signed in: skip the form. A failing session check (server unreachable) just shows the form.
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient)).catch(() => null);
    if (user) throw redirect({ to: search.redirect ?? "/" });
  },
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  staticData: { crumb: "Início" },
  component: lazyRouteComponent(() => import("./routes/dashboard"), "DashboardPage"),
});

const customersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/clientes",
  staticData: { crumb: "Clientes" },
  component: Outlet,
});
const customersIndexRoute = createRoute({
  getParentRoute: () => customersRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => parseCustomersSearch(search),
  component: lazyRouteComponent(() => import("./routes/customers-route"), "CustomersRoute"),
});
const customerDetailRoute = createRoute({
  getParentRoute: () => customersRoute,
  path: "$code",
  staticData: { crumb: (params) => `Cliente ${params.code ?? ""}`.trim() },
  component: lazyRouteComponent(() => import("./routes/customers-route"), "CustomerDetailRoute"),
});

const productsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/produtos",
  staticData: { crumb: "Produtos" },
  validateSearch: (search: Record<string, unknown>) => parseProductsSearch(search),
  component: lazyRouteComponent(() => import("./routes/products-route"), "ProductsRoute"),
});

const ordersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/pedidos",
  staticData: { crumb: "Pedidos" },
  component: Outlet,
});
const ordersIndexRoute = createRoute({
  getParentRoute: () => ordersRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => parseOrdersSearch(search),
  component: lazyRouteComponent(() => import("./routes/orders-route"), "OrdersRoute"),
});
const newOrderRoute = createRoute({
  getParentRoute: () => ordersRoute,
  path: "novo",
  staticData: { crumb: "Novo pedido" },
  validateSearch: (search: Record<string, unknown>): { customer?: number } => {
    const customer = asInt(search.customer, 0);
    return customer === undefined ? {} : { customer };
  },
  component: lazyRouteComponent(() => import("./routes/orders-route"), "NewOrderRoute"),
});
const orderDetailRoute = createRoute({
  getParentRoute: () => ordersRoute,
  path: "$id",
  staticData: { crumb: "Pedido" },
  component: lazyRouteComponent(() => import("./routes/orders-route"), "OrderRoute"),
});

const integrationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/integracao",
  staticData: { crumb: "Integração" },
  // Not a page for every profile: whoever may not see it lands on the start page, without a request for its data.
  // The server (getConfiguration) is what enforces it; this only keeps the screen out of the way.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient));
    if (!user || !canSeeIntegration(user.role)) throw redirect({ to: "/" });
  },
  component: lazyRouteComponent(() => import("./routes/integration"), "IntegrationPage"),
});

/**
 * Dev-only kitchen sink with synthetic data. Registered only when `import.meta.env.DEV`, so it is absent from
 * production builds. Outside the session guard on purpose (it shows no user data) and rendered in the shell without a user.
 */
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/_design",
        staticData: { crumb: "Design system" },
        component: lazyRouteComponent(() => import("./routes/design"), "DesignRoute"),
      }),
    ]
  : [];

/** Unknown URLs: session-guarded and rendered inside the shell (anonymous visitors are sent to the login). */
const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "$",
  staticData: { crumb: "Não encontrada" },
  component: NotFound,
});

const appChildren = [
  dashboardRoute,
  notFoundRoute,
  customersRoute.addChildren([customersIndexRoute, customerDetailRoute]),
  productsRoute,
  ordersRoute.addChildren([ordersIndexRoute, newOrderRoute, orderDetailRoute]),
  integrationRoute,
];

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren(appChildren),
  ...devRoutes,
]);

export function createAppRouter(context: RouterContext, options: { history?: RouterHistory } = {}) {
  return createRouter({
    routeTree,
    context,
    history: options.history,
    defaultPreload: "intent",
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
    defaultNotFoundComponent: NotFound,
    // Router scroll restoration persists positions in sessionStorage; the app keeps nothing in web storage.
    scrollRestoration: false,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
