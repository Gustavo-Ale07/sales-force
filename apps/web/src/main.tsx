import { TooltipProvider, Toaster } from "@salesforce/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AppServicesProvider } from "./lib/app-context";
import { unconfiguredAuthClient } from "./lib/auth-client";
import { createQueryClient } from "./lib/query-client";
import { loadRuntimeConfig } from "./lib/runtime-config";
import { createAppRouter } from "./router";

async function bootstrap() {
  const config = await loadRuntimeConfig();
  // Real implementation (generated API client, same-origin /api, cookie session) is wired here once the contracts exist.
  const authClient = unconfiguredAuthClient;

  // Assigned after the client exists: the 401 handler needs the router, the router context needs the client.
  const routerRef: { current?: ReturnType<typeof createAppRouter> } = {};
  const queryClient = createQueryClient({
    onUnauthorized: () => {
      // Session expired or revoked: drop cached data and return to the login screen, keeping the target.
      queryClient.clear();
      const current = routerRef.current;
      if (current && current.state.location.pathname !== "/login") {
        void current.navigate({ to: "/login", search: { redirect: current.state.location.href } });
      }
    },
  });
  const router = createAppRouter({ queryClient, authClient });
  routerRef.current = router;

  const container = document.getElementById("root");
  if (!container) throw new Error("Elemento #root não encontrado");
  createRoot(container).render(
    <StrictMode>
      <AppServicesProvider value={{ config, authClient }}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </AppServicesProvider>
    </StrictMode>,
  );
}

void bootstrap();
