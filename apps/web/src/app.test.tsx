import { TooltipProvider } from "@salesforce/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEV_AUTH_NOTICE } from "./components/dev-auth-banner";
import { AppServicesProvider } from "./lib/app-context";
import type { AuthClient, AuthUser } from "./lib/auth-client";
import { defaultRuntimeConfig } from "./lib/runtime-config";
import { createAppRouter } from "./router";

const user: AuthUser = { id: "u-1", name: "Ana Souza", email: "ana@example.test", roleLabel: "Vendedor" };

function fakeClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockResolvedValue({ ok: false, reason: "invalid_credentials" }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderApp(initialPath: string, authClient: AuthClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ queryClient, authClient }, { history: createMemoryHistory({ initialEntries: [initialPath] }) });
  render(
    <AppServicesProvider value={{ config: defaultRuntimeConfig, authClient }}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </AppServicesProvider>,
  );
  return router;
}

describe("session guard", () => {
  it("redirects an anonymous visitor to /login keeping the target", async () => {
    const router = renderApp("/clientes", fakeClient());
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ redirect: "/clientes" });
  });

  it("renders the shell with active navigation and breadcrumbs for a signed-in user", async () => {
    renderApp("/clientes", fakeClient({ getSession: vi.fn().mockResolvedValue(user) }));
    expect(await screen.findByRole("heading", { name: "Carteira de clientes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: /Trilha|Breadcrumb|Você está em/i })).toBeInTheDocument();
    expect(screen.getByText("Em construção")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Clientes — Sales Force"));
  });

  it("shows the not-found state inside the shell", async () => {
    renderApp("/nao-existe", fakeClient({ getSession: vi.fn().mockResolvedValue(user) }));
    expect(await screen.findByText("Página não encontrada")).toBeInTheDocument();
  });

  it("shows a dynamic crumb for detail routes", async () => {
    renderApp("/clientes/1001", fakeClient({ getSession: vi.fn().mockResolvedValue(user) }));
    expect(await screen.findByRole("heading", { name: "Cliente 1001" })).toBeInTheDocument();
  });
});

describe("login page", () => {
  it("shows the dev-auth banner and validates before calling the client", async () => {
    const authClient = fakeClient();
    renderApp("/login", authClient);
    expect(await screen.findByText(DEV_AUTH_NOTICE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Informe o e-mail.")).toBeInTheDocument();
    expect(screen.getByLabelText(/E-mail/)).toHaveFocus();
    expect(authClient.login).not.toHaveBeenCalled();
  });

  it("reports wrong credentials with an alert and clears the password", async () => {
    const authClient = fakeClient();
    renderApp("/login", authClient);
    await userEvent.type(await screen.findByLabelText(/E-mail/), "ana@example.test");
    await userEvent.type(screen.getByLabelText(/Senha/), "senha-errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha incorretos.");
    expect(screen.getByLabelText(/Senha/)).toHaveValue("");
    expect(authClient.login).toHaveBeenCalledWith({ email: "ana@example.test", password: "senha-errada" });
  });

  it("shows the unavailable state when the auth service is not wired", async () => {
    renderApp("/login", fakeClient({ login: vi.fn().mockResolvedValue({ ok: false, reason: "unavailable" }) }));
    await userEvent.type(await screen.findByLabelText(/E-mail/), "ana@example.test");
    await userEvent.type(screen.getByLabelText(/Senha/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível entrar agora.");
  });

  it("signs in and goes to the safe redirect target", async () => {
    const authClient = fakeClient({ login: vi.fn().mockResolvedValue({ ok: true, user }) });
    const router = renderApp("/login?redirect=/pedidos", authClient);
    await userEvent.type(await screen.findByLabelText(/E-mail/), "ana@example.test");
    await userEvent.type(screen.getByLabelText(/Senha/), "segredo");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/pedidos");
  });

  it("ignores an external redirect target", async () => {
    const authClient = fakeClient({ login: vi.fn().mockResolvedValue({ ok: true, user }) });
    const router = renderApp("/login?redirect=https://evil.example", authClient);
    await userEvent.type(await screen.findByLabelText(/E-mail/), "ana@example.test");
    await userEvent.type(screen.getByLabelText(/Senha/), "segredo");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Início" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("toggles password visibility", async () => {
    renderApp("/login", fakeClient());
    const password = await screen.findByLabelText(/Senha/);
    expect(password).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(password).toHaveAttribute("type", "text");
  });
});
