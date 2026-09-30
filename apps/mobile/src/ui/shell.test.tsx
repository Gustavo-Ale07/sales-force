import { Alert } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CustomerRepository, ProductRepository } from "../data/ports";
import {
  account,
  customer,
  fakeAuth,
  fakeConnectivity,
  fakeDependencies,
  fakeOrders,
  fakeProducts,
  networkError,
  pageOf,
  product,
  unauthenticatedError,
} from "../test-doubles";
import type { SyncManager, SyncStatus } from "@salesforce/mobile-db";
import type { OfflineServices } from "../offline/services";
import type { RememberedSession } from "../offline/session";
import { Shell } from "./shell";

function fakeOffline(remembered: RememberedSession | null, status: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null }) {
  const syncNow = jest.fn(async () => status);
  const sync: SyncManager = {
    sync: syncNow,
    getStatus: () => status,
    subscribe: () => () => undefined,
    refresh: async () => status,
  };
  const forget = jest.fn(async () => undefined);
  const offline: OfflineServices = {
    session: { load: async () => remembered, remember: async () => undefined, forget },
    forAccount: () => ({
      repositories: fakeDependencies().repositories,
      localOrders: {
        save: async () => {
          throw new Error("unused");
        },
        list: async () => [],
        open: async () => null,
        discard: async () => undefined,
        acknowledgePriceReview: async () => undefined,
        resolveConflict: async () => undefined,
      },
      sync,
    }),
  };
  return { offline, forget, syncNow };
}

const unreachable = () =>
  fakeAuth({
    getSession: async () => {
      throw networkError();
    },
  });

const signedIn = () => fakeAuth({ getSession: async () => account });

/** Sair lives in Perfil and asks for confirmation; the test accepts it. */
async function signOutFromProfile() {
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.style === "destructive")?.onPress?.();
  });
  await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
  await fireEvent.press(screen.getByRole("button", { name: "Sair" }));
  alert.mockRestore();
}

describe("Shell", () => {
  it("shows the login form when there is no session", async () => {
    await render(<Shell dependencies={fakeDependencies()} />);
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
  });

  it("falls back to the login form when the session probe cannot reach the server", async () => {
    const auth = fakeAuth({
      getSession: async () => {
        throw networkError();
      },
    });
    await render(<Shell dependencies={fakeDependencies({ auth })} />);
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
  });

  it("opens offline with the remembered account when the server is unreachable", async () => {
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: unreachable(), offline })} />);
    expect(await screen.findByText("Olá, Ana Vendedora")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Vendas" })).toBeTruthy();
    expect(screen.getByLabelText("Status de sincronização: Online")).toBeTruthy();
  });

  it("asks for an online login when the remembered account is older than the offline window", async () => {
    const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { offline } = fakeOffline({ account, lastOnlineAt: stale });
    await render(<Shell dependencies={fakeDependencies({ auth: unreachable(), offline })} />);
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
  });

  it("forgets the remembered account on sign-out", async () => {
    const { offline, forget } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await signOutFromProfile();
    await waitFor(() => expect(forget).toHaveBeenCalled());
  });

  it("lists the customers of an existing session and switches to the catalog", async () => {
    const customers: CustomerRepository = {
      list: async () => pageOf([customer(10, { name: "Padaria Central", blocked: true })]),
    };
    const products: ProductRepository = fakeProducts({ list: async () => pageOf([product(5, { description: "Copo 200 ml" })]) });
    await render(
      <Shell dependencies={fakeDependencies({ auth: signedIn(), repositories: { customers, products, orders: fakeOrders() } })} />,
    );
    expect(await screen.findByText("Olá, Ana Vendedora")).toBeTruthy();
    await fireEvent.press(screen.getByRole("tab", { name: "Clientes" }));
    expect(await screen.findByText("Padaria Central")).toBeTruthy();
    expect(screen.getByText("Bloqueado")).toBeTruthy();

    await fireEvent.press(screen.getByRole("tab", { name: "Catálogo" }));
    expect(await screen.findByText("Copo 200 ml")).toBeTruthy();
    // No price resolved: the catalog says so, it never shows zero (P-09).
    expect(screen.getByText("Sem preço")).toBeTruthy();
  });

  it("returns to the login form when a list request answers 401", async () => {
    const customers: CustomerRepository = {
      list: async () => {
        throw unauthenticatedError();
      },
    };
    await render(
      <Shell
        dependencies={fakeDependencies({
          auth: signedIn(),
          repositories: { customers, products: fakeProducts(), orders: fakeOrders() },
        })}
      />,
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
  });

  it("signs out even when the logout call fails", async () => {
    const auth = fakeAuth({
      getSession: async () => account,
      logout: async () => {
        throw networkError();
      },
    });
    await render(<Shell dependencies={fakeDependencies({ auth })} />);
    await signOutFromProfile();
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
  });

  it("tells the truth about offline: no data is kept on the device yet", async () => {
    const connectivity = fakeConnectivity("online");
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline, connectivity: connectivity.port })} />);
    expect(await screen.findByText("Online")).toBeTruthy();
    expect(screen.queryByText(/Exibindo os dados salvos neste aparelho/)).toBeNull();

    await act(async () => connectivity.emit("offline"));
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());
    expect(screen.getByText(/Exibindo os dados salvos neste aparelho/)).toBeTruthy();
  });

  it("shows a retryable error when the list cannot be loaded offline", async () => {
    let calls = 0;
    const customers: CustomerRepository = {
      list: async (request) => {
        if (request.pageSize === 1) return pageOf([]); // the Home's counter read, not the screen under test
        calls += 1;
        if (calls === 1) throw networkError();
        return pageOf([customer(1, { name: "Mercado Sul" })]);
      },
    };
    await render(
      <Shell
        dependencies={fakeDependencies({
          auth: signedIn(),
          repositories: { customers, products: fakeProducts(), orders: fakeOrders() },
        })}
      />,
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Mercado Sul")).toBeTruthy();
  });

  it("offers the five main destinations in the bottom navigation", async () => {
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn() })} />);
    await screen.findByText("Olá, Ana Vendedora");
    for (const name of ["Início", "Clientes", "Vendas", "Catálogo", "Perfil"]) expect(screen.getByRole("tab", { name })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Início" }).props.accessibilityState.selected).toBe(true);
  });

  it("keeps a visited tab mounted, so its state is not rebuilt when the seller comes back", async () => {
    let calls = 0;
    const customers: CustomerRepository = {
      list: async (request) => {
        if (request.pageSize === 1) return pageOf([]); // the Home's counter read, not the screen under test
        calls += 1;
        return pageOf([customer(1, { name: "Mercado Sul" })]);
      },
    };
    await render(
      <Shell dependencies={fakeDependencies({ auth: signedIn(), repositories: { customers, products: fakeProducts(), orders: fakeOrders() } })} />,
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
    await screen.findByText("Mercado Sul");
    await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Clientes" }));
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
    expect(calls).toBe(1);
  });

  it("shows the account, version and a real manual sync in Perfil", async () => {
    const pending: SyncStatus = { phase: "idle", pending: 2, needsAttention: 0, lastSyncedAt: "2026-09-30T15:30:00.000Z", lastError: null };
    const { offline, syncNow } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, pending);
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
    expect(screen.getAllByText("Vendedor").length).toBeGreaterThan(0);
    expect(screen.getByText("ana@plac.com.br")).toBeTruthy();
    expect(screen.getByText("Versão")).toBeTruthy();
    expect(screen.getByText("Alterações pendentes")).toBeTruthy();
    syncNow.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(syncNow).toHaveBeenCalledWith("manual");
  });

  it("opens the existing local-orders list from Perfil", async () => {
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
    await fireEvent.press(screen.getByRole("button", { name: "Ver pedidos salvos neste aparelho" }));
    expect(await screen.findByText("Nenhum pedido salvo neste aparelho.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Vendas" }).props.accessibilityState.selected).toBe(true);
  });

  it("says so when the seller enters offline with the saved session", async () => {
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    const connectivity = fakeConnectivity("offline");
    await render(<Shell dependencies={fakeDependencies({ auth: unreachable(), offline, connectivity: connectivity.port })} />);
    expect(await screen.findByText(/Modo offline: você entrou com a sessão salva/)).toBeTruthy();
  });

  it("opens the customer sheet from Clientes, goes back, and starts a new order for that customer", async () => {
    const customers: CustomerRepository = {
      list: async (request) => (request.pageSize === 1 ? pageOf([]) : pageOf([customer(10, { name: "Padaria Central", document: "12345678000190" })])),
    };
    const products: ProductRepository = fakeProducts({ list: async () => pageOf([product(5, { description: "Copo 200 ml" })]) });
    await render(
      <Shell dependencies={fakeDependencies({ auth: signedIn(), repositories: { customers, products, orders: fakeOrders() } })} />,
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
    await fireEvent.press(await screen.findByRole("button", { name: /Padaria Central, código 10/ }));
    expect(await screen.findByRole("button", { name: "Voltar para Clientes" })).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Voltar para Clientes" }));
    expect(screen.queryByRole("button", { name: "Voltar para Clientes" })).toBeNull();
    expect(screen.getByText("Padaria Central")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: /Padaria Central, código 10/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "Novo pedido" }));
    expect(await screen.findByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Vendas" }).props.accessibilityState.selected).toBe(true);
  });
});
