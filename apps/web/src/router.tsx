import type { QueryClient } from "@tanstack/react-query";
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
import { safeRedirect } from "./lib/safe-redirect";
import { LoginPage } from "./routes/login";
import {
  CustomerDetailPage,
  CustomersPage,
  DashboardPage,
  IntegrationPage,
  NewOrderPage,
  OrderDetailPage,
  OrdersPage,
  ProductsPage,
} from "./routes/pages";

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
    onSettled: async () => {
      queryClient.clear();
      await router.navigate({ to: "/login" });
    },
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
    // Already signed in: skip the form.
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient));
    if (user) throw redirect({ to: search.redirect ?? "/" });
  },
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  staticData: { crumb: "Início" },
  component: DashboardPage,
});

const customersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/clientes",
  staticData: { crumb: "Clientes" },
  component: Outlet,
});
const customersIndexRoute = createRoute({ getParentRoute: () => customersRoute, path: "/", component: CustomersPage });
const customerDetailRoute = createRoute({
  getParentRoute: () => customersRoute,
  path: "$code",
  staticData: { crumb: (params) => `Cliente ${params.code ?? ""}`.trim() },
  component: CustomerDetailPage,
});

const productsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/produtos",
  staticData: { crumb: "Produtos" },
  component: ProductsPage,
});

const ordersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/pedidos",
  staticData: { crumb: "Pedidos" },
  component: Outlet,
});
const ordersIndexRoute = createRoute({ getParentRoute: () => ordersRoute, path: "/", component: OrdersPage });
const newOrderRoute = createRoute({
  getParentRoute: () => ordersRoute,
  path: "novo",
  staticData: { crumb: "Novo pedido" },
  component: NewOrderPage,
});
const orderDetailRoute = createRoute({
  getParentRoute: () => ordersRoute,
  path: "$id",
  staticData: { crumb: (params) => `Pedido ${params.id ?? ""}`.trim() },
  component: OrderDetailPage,
});

const integrationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/integracao",
  staticData: { crumb: "Integração" },
  component: IntegrationPage,
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
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
