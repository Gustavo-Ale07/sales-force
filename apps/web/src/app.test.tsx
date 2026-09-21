import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEV_AUTH_NOTICE } from "./components/dev-auth-banner";
import { customersPage, customerDetail, dashboard, ordersPage } from "./test/fixtures";
import { apiError, callsTo, openUserMenu, renderApp, session } from "./test/harness";

const shellData = {
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
};

describe("session guard", () => {
  it("redirects an anonymous visitor to /login keeping the target", async () => {
    const { router } = renderApp("/clientes", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ redirect: "/clientes" });
  });

  it("renders the shell with active navigation and breadcrumbs for a signed-in user", async () => {
    renderApp("/clientes", { handlers: shellData });
    expect(await screen.findByRole("heading", { name: "Carteira de clientes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: /Trilha|Breadcrumb|Você está em/i })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Clientes — Sales Force"));
  });

  it("uses the installation name from the runtime configuration, never a built-in brand", async () => {
    renderApp("/clientes", { handlers: shellData, config: { installationName: "Instalação Teste" } });
    expect(await screen.findByRole("heading", { name: "Carteira de clientes" })).toBeInTheDocument();
    expect(screen.getAllByText("Instalação Teste").length).toBeGreaterThan(0);
    await waitFor(() => expect(document.title).toBe("Clientes — Instalação Teste"));
  });

  it("shows the not-found state inside the shell", async () => {
    renderApp("/nao-existe", { handlers: shellData });
    expect(await screen.findByText("Página não encontrada")).toBeInTheDocument();
  });

  it("shows the detail route inside the shell", async () => {
    renderApp("/clientes/1001", { handlers: shellData });
    expect(await screen.findByRole("heading", { name: /Comercial Alfa Ltda/ })).toBeInTheDocument();
  });

  it("sends an expired session (401 on the session probe) to the login page", async () => {
    const { router } = renderApp("/pedidos", { handlers: { "GET /auth/session": apiError(401, "unauthenticated", "Sessão expirada.") } });
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ redirect: "/pedidos" });
  });

  it("leaves a signed-in visitor of /login on the home page", async () => {
    const { router } = renderApp("/login", { handlers: shellData });
    expect(await screen.findByRole("heading", { name: "Início" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("logout", () => {
  it("calls the API, clears the cache and returns to the login page", async () => {
    let signedIn = true;
    const { user, calls, router } = renderApp("/", {
      handlers: {
        ...shellData,
        "GET /auth/session": () => session(signedIn),
        "POST /auth/logout": () => {
          signedIn = false;
          return { status: 204 };
        },
      },
    });
    await openUserMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Sair" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/auth/logout")).toHaveLength(1));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("stays signed in and says so when the logout request fails", async () => {
    const { user, router } = renderApp("/", {
      handlers: { ...shellData, "POST /auth/logout": apiError(503, "service_unavailable", "Indisponível.") },
    });
    await openUserMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Sair" }));
    expect(await screen.findByText("Não foi possível encerrar a sessão")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("login page", () => {
  const typeCredentials = async (user: ReturnType<typeof renderApp>["user"], password = "segredo") => {
    await user.type(await screen.findByLabelText(/E-mail/), "ana@example.test");
    await user.type(screen.getByLabelText(/Senha/), password);
    await user.click(screen.getByRole("button", { name: "Entrar" }));
  };

  it("shows the dev-auth banner and validates before calling the API", async () => {
    const { user, calls } = renderApp("/login", { signedIn: false });
    expect(await screen.findByText(DEV_AUTH_NOTICE)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Informe o e-mail.")).toBeInTheDocument();
    expect(screen.getByLabelText(/E-mail/)).toHaveFocus();
    expect(callsTo(calls, "POST", "/auth/login")).toHaveLength(0);
  });

  it("hides the dev-auth banner outside the dev auth mode", async () => {
    renderApp("/login", { signedIn: false, config: { authMode: "standard" } });
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByText(DEV_AUTH_NOTICE)).not.toBeInTheDocument();
  });

  it("reports wrong credentials with an alert and clears the password", async () => {
    const { user, calls } = renderApp("/login", {
      signedIn: false,
      handlers: { "POST /auth/login": apiError(401, "invalid_credentials", "Credenciais inválidas.") },
    });
    await typeCredentials(user, "senha-errada");
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha incorretos.");
    expect(screen.getByLabelText(/Senha/)).toHaveValue("");
    expect(callsTo(calls, "POST", "/auth/login")[0]?.body).toEqual({ email: "ana@example.test", password: "senha-errada" });
  });

  it("shows the Retry-After wait when rate limited", async () => {
    const { user } = renderApp("/login", {
      signedIn: false,
      handlers: { "POST /auth/login": apiError(429, "rate_limited", "Muitas tentativas.", { headers: { "retry-after": "120" } }) },
    });
    await typeCredentials(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Muitas tentativas em pouco tempo.");
    expect(alert).toHaveTextContent("2 minutos");
  });

  it("explains that the profile only uses the mobile app when the channel is forbidden", async () => {
    const { user } = renderApp("/login", {
      signedIn: false,
      handlers: { "POST /auth/login": apiError(403, "forbidden", "Canal não permitido.") },
    });
    await typeCredentials(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Este perfil acessa somente pelo aplicativo móvel.");
  });

  it("shows the unavailable state on a server failure", async () => {
    const { user } = renderApp("/login", {
      signedIn: false,
      handlers: { "POST /auth/login": apiError(503, "service_unavailable", "Indisponível.", { requestId: "req-login-1" }) },
    });
    await typeCredentials(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível entrar agora.");
  });

  it("signs in and goes to the safe redirect target", async () => {
    let signedIn = false;
    const { user, router } = renderApp("/login?redirect=/pedidos", {
      signedIn: false,
      handlers: {
        ...shellData,
        "GET /auth/session": () => session(signedIn),
        "POST /auth/login": () => {
          signedIn = true;
          return session(true);
        },
      },
    });
    await typeCredentials(user);
    expect(await screen.findByRole("heading", { name: "Pedidos e rascunhos" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/pedidos");
  });

  it("ignores an external redirect target", async () => {
    let signedIn = false;
    const { user, router } = renderApp("/login?redirect=https://evil.example", {
      signedIn: false,
      handlers: {
        ...shellData,
        "GET /auth/session": () => session(signedIn),
        "POST /auth/login": () => {
          signedIn = true;
          return session(true);
        },
      },
    });
    await typeCredentials(user);
    expect(await screen.findByRole("heading", { name: "Início" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("toggles password visibility", async () => {
    const { user } = renderApp("/login", { signedIn: false });
    const password = await screen.findByLabelText(/Senha/);
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(password).toHaveAttribute("type", "text");
  });
});

describe("integration pill and dev banner in the shell", () => {
  it("shows the integration state from /ready", async () => {
    renderApp("/", { handlers: shellData });
    const banner = await screen.findByText(DEV_AUTH_NOTICE);
    expect(banner).toBeInTheDocument();
    expect(await screen.findByText("Integração: não configurada")).toBeInTheDocument();
  });

  it("shows the integration as unavailable when /ready fails", async () => {
    renderApp("/", { handlers: { ...shellData, "GET /ready": apiError(503, "service_unavailable", "Fora do ar.") } });
    expect(await screen.findByText("Integração: indisponível")).toBeInTheDocument();
  });

  it("shows the degraded state", async () => {
    renderApp("/", {
      handlers: {
        ...shellData,
        "GET /ready": {
          body: {
            status: "degraded",
            checks: { database: "ok", migrations: { status: "ok", applied: "1", expected: "1" } },
            integration: { state: "degraded", gatewayMode: "live", lastSuccessAt: null, failingEntities: ["products"], message: null },
          },
        },
      },
    });
    expect(await screen.findByText("Integração: degradada")).toBeInTheDocument();
  });

  it("does not render the dev banner outside the dev auth mode", async () => {
    renderApp("/", { handlers: shellData, config: { authMode: "standard" } });
    expect(await screen.findByRole("heading", { name: "Início" })).toBeInTheDocument();
    expect(screen.queryByText(DEV_AUTH_NOTICE)).not.toBeInTheDocument();
    expect(within(document.body).queryByText(/Ambiente de desenvolvimento/)).not.toBeInTheDocument();
  });
});
