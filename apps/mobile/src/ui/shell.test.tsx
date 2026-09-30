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

function fakeOffline(remembered: RememberedSession | null) {
  const status: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };
  const sync: SyncManager = {
    sync: async () => status,
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
  return { offline, forget };
}

const unreachable = () =>
  fakeAuth({
    getSession: async () => {
      throw networkError();
    },
  });

const signedIn = () => fakeAuth({ getSession: async () => account });

describe("Shell", () => {
  it("shows the login form when there is no session", async () => {
    await render(<Shell dependencies={fakeDependencies()} />);
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("falls back to the login form when the session probe cannot reach the server", async () => {
    const auth = fakeAuth({
      getSession: async () => {
        throw networkError();
      },
    });
    await render(<Shell dependencies={fakeDependencies({ auth })} />);
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("opens offline with the remembered account when the server is unreachable", async () => {
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: unreachable(), offline })} />);
    expect(await screen.findByText("Ana Vendedora")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Pedidos" })).toBeTruthy();
    expect(screen.getByText("✓ Sincronizado")).toBeTruthy();
  });

  it("asks for an online login when the remembered account is older than the offline window", async () => {
    const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { offline } = fakeOffline({ account, lastOnlineAt: stale });
    await render(<Shell dependencies={fakeDependencies({ auth: unreachable(), offline })} />);
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("forgets the remembered account on sign-out", async () => {
    const { offline, forget } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sair" }));
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
    expect(await screen.findByText("Padaria Central")).toBeTruthy();
    expect(screen.getByText("Bloqueado")).toBeTruthy();
    expect(screen.getByText("Ana Vendedora")).toBeTruthy();

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
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("signs out even when the logout call fails", async () => {
    const auth = fakeAuth({
      getSession: async () => account,
      logout: async () => {
        throw networkError();
      },
    });
    await render(<Shell dependencies={fakeDependencies({ auth })} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sair" }));
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("tells the truth about offline: no data is kept on the device yet", async () => {
    const connectivity = fakeConnectivity("online");
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), connectivity: connectivity.port })} />);
    expect(await screen.findByText("Online")).toBeTruthy();
    expect(screen.queryByText(/Exibindo os dados salvos neste aparelho/)).toBeNull();

    await act(async () => connectivity.emit("offline"));
    await waitFor(() => expect(screen.getByText("Sem conexão")).toBeTruthy());
    expect(screen.getByText(/Exibindo os dados salvos neste aparelho/)).toBeTruthy();
  });

  it("shows a retryable error when the list cannot be loaded offline", async () => {
    let calls = 0;
    const customers: CustomerRepository = {
      list: async () => {
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
    await fireEvent.press(await screen.findByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Mercado Sul")).toBeTruthy();
  });
});
