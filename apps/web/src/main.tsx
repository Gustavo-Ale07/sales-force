import { TooltipProvider, Toaster } from "@salesforce/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { applyBrand } from "./lib/brand";
import { AppServicesProvider } from "./lib/app-context";
import { createWebApiClient } from "./lib/api";
import { createApiAuthClient } from "./lib/api-auth-client";
import { createQueryClient } from "./lib/query-client";
import { loadRuntimeConfig } from "./lib/runtime-config";
import { createAppRouter } from "./router";

async function bootstrap() {
  const config = await loadRuntimeConfig();
  applyBrand(config.brand);
  // Same-origin generated client with the cookie session; no token is ever held by the app.
  const api = createWebApiClient();
  const authClient = createApiAuthClient(api);

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
      <AppServicesProvider value={{ config, authClient, api }}>
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

void bootstrap().catch((error: unknown) => {
  // Nothing in bootstrap() is expected to throw, but a silent rejection here would leave #root
  // empty with no signal at all. Render a visible, actionable fallback instead of a white screen.
  console.error("Falha ao iniciar o aplicativo:", error);
  const container = document.getElementById("root");
  if (!container) return;
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.setAttribute(
    "style",
    "display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#f4f5f7;color:#1a1a2e;text-align:center;",
  );
  const box = document.createElement("div");
  box.setAttribute("style", "max-width:420px;");
  const title = document.createElement("h1");
  title.textContent = "Não foi possível iniciar o aplicativo";
  title.setAttribute("style", "font-size:18px;font-weight:600;margin:0 0 8px;");
  const description = document.createElement("p");
  description.textContent = "Recarregue a página. Se o problema continuar, fale com o administrador.";
  description.setAttribute("style", "font-size:14px;color:#4a4a5a;margin:0 0 16px;");
  const button = document.createElement("button");
  button.textContent = "Recarregar";
  button.setAttribute(
    "style",
    "font-size:14px;font-weight:600;padding:8px 20px;border-radius:8px;border:none;background:#001369;color:#fff;cursor:pointer;",
  );
  button.addEventListener("click", () => window.location.reload());
  box.append(title, description, button);
  wrapper.append(box);
  container.append(wrapper);
});
