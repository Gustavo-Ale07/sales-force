import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  useNavigate,
  useParams,
  useRouter,
  useSearch,
  type RouterHistory,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import { NotFound, RouteError, RoutePending } from "./components/route-states";
import { useAppServices } from "./lib/app-context";
import { sessionQueryOptions, type AuthClient } from "./lib/auth-client";
import { safeRedirect } from "./lib/safe-redirect";
import { asInt } from "./lib/search-params";
import { CustomerDetailPage } from "./routes/customer-detail";
import { CustomersPage, parseCustomersSearch } from "./routes/customers";
import { DashboardPage } from "./routes/dashboard";
import { IntegrationPage } from "./routes/integration";
import { LoginPage } from "./routes/login";
import { OrderEditorPage } from "./routes/order-editor";
import { OrdersPage, parseOrdersSearch } from "./routes/orders";
import { ProductsPage, parseProductsSearch } from "./routes/products";

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

function CustomersRouteComponent() {
  const navigate = useNavigate();
  const params = parseCustomersSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return (
    <CustomersPage
      params={params}
      onSearchChange={(next) => void navigate({ to: "/clientes", search: next, replace: true })}
      onOpenCustomer={(code) => void navigate({ to: "/clientes/$code", params: { code: String(code) } })}
    />
  );
}

function CustomerDetailRouteComponent() {
  const { code } = useParams({ strict: false });
  const parsed = asInt(code, 0);
  return parsed === undefined ? <NotFound /> : <CustomerDetailPage code={parsed} />;
}

function ProductsRouteComponent() {
  const navigate = useNavigate();
  const params = parseProductsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return <ProductsPage params={params} onSearchChange={(next) => void navigate({ to: "/produtos", search: next, replace: true })} />;
}

function OrdersRouteComponent() {
  const navigate = useNavigate();
  const params = parseOrdersSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return (
    <OrdersPage
      params={params}
      onSearchChange={(next) => void navigate({ to: "/pedidos", search: next, replace: true })}
      onOpenOrder={(id) => void navigate({ to: "/pedidos/$id", params: { id } })}
    />
  );
}

function NewOrderRouteComponent() {
  const navigate = useNavigate();
  const { customer } = useSearch({ strict: false }) as { customer?: unknown };
  return (
    <OrderEditorPage
      initialCustomerCode={asInt(customer, 0)}
      onCreated={(id) => void navigate({ to: "/pedidos/$id", params: { id }, replace: true })}
      onClose={() => void navigate({ to: "/pedidos" })}
    />
  );
}

function OrderRouteComponent() {
  const navigate = useNavigate();
  const { id } = useParams({ strict: false });
  if (!id) return <NotFound />;
  return <OrderEditorPage orderId={id} onCreated={() => undefined} onClose={() => void navigate({ to: "/pedidos" })} />;
}

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
const customersIndexRoute = createRoute({
  getParentRoute: () => customersRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => parseCustomersSearch(search),
  component: CustomersRouteComponent,
});
const customerDetailRoute = createRoute({
  getParentRoute: () => customersRoute,
  path: "$code",
  staticData: { crumb: (params) => `Cliente ${params.code ?? ""}`.trim() },
  component: CustomerDetailRouteComponent,
});

const productsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/produtos",
  staticData: { crumb: "Produtos" },
  validateSearch: (search: Record<string, unknown>) => parseProductsSearch(search),
  component: ProductsRouteComponent,
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
  component: OrdersRouteComponent,
});
const newOrderRoute = createRoute({
  getParentRoute: () => ordersRoute,
  path: "novo",
  staticData: { crumb: "Novo pedido" },
  validateSearch: (search: Record<string, unknown>): { customer?: number } => {
    const customer = asInt(search.customer, 0);
    return customer === undefined ? {} : { customer };
  },
  component: NewOrderRouteComponent,
});
const orderDetailRoute = createRoute({
  getParentRoute: () => ordersRoute,
  path: "$id",
  staticData: { crumb: "Pedido" },
  component: OrderRouteComponent,
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
    // Router scroll restoration persists positions in sessionStorage; the app keeps nothing in web storage.
    scrollRestoration: false,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
