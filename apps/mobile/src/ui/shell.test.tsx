import { Alert } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CustomerRepository, ProductRepository, Repositories } from "../data/ports";
import {
  account,
  customer,
  draftRecord,
  fakeAuth,
  fakeConnectivity,
  fakeDependencies,
  fakeLocalOrders,
  fakeOrders,
  fakeProducts,
  networkError,
  pageOf,
  product,
  unauthenticatedError,
} from "../test-doubles";
import type { SyncManager, SyncStatus } from "@salesforce/mobile-db";
import type { LocalOrdersPort } from "../offline/local-orders";
import type { OfflineServices } from "../offline/services";
import type { RememberedSession } from "../offline/session";
import type { ProductImageStore } from "../images/image-store";
import { Shell } from "./shell";

function fakeOffline(
  remembered: RememberedSession | null,
  status: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null },
  localOrders: LocalOrdersPort = fakeLocalOrders(),
  productImages?: ProductImageStore,
  repositories: Repositories = fakeDependencies().repositories,
) {
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
      repositories,
      localOrders,
      sync,
      ...(productImages === undefined ? {} : { productImages }),
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

  describe("thumbnail cache lifecycle", () => {
    const imageStore = () => ({ resolve: jest.fn(async () => null), purge: jest.fn(async () => undefined) });
    const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

    it("is purged on an explicit sign-out", async () => {
      const images = imageStore();
      const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, idle, fakeLocalOrders(), images);
      await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
      await signOutFromProfile();
      await waitFor(() => expect(images.purge).toHaveBeenCalledTimes(1));
    });

    it("is NOT purged (and the remembered account is kept) when the session merely expires for the same owner", async () => {
      const images = imageStore();
      const customers: CustomerRepository = {
        list: async () => {
          throw unauthenticatedError();
        },
      };
      const { offline, forget } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, idle, fakeLocalOrders(), images, { customers, products: fakeProducts(), orders: fakeOrders() });
      await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
      await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
      expect(await screen.findByLabelText("E-mail")).toBeTruthy();
      expect(images.purge).not.toHaveBeenCalled();
      expect(forget).not.toHaveBeenCalled();
    });
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

  describe("when the server logout fails", () => {
    /** Presses Sair, accepts the sign-out confirmation, and answers the failure alert with the button `choose` (if any). */
    async function signOutFailing(logout: jest.Mock, choose: string | null) {
      const auth = fakeAuth({ getSession: async () => account, logout });
      const { offline, forget } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
      await render(<Shell dependencies={fakeDependencies({ auth, offline })} />);
      const alert = jest.spyOn(Alert, "alert").mockImplementation((title, _message, buttons) => {
        if (title === "Sair do Force") buttons?.find((button) => button.style === "destructive")?.onPress?.();
        else if (choose !== null) buttons?.find((button) => button.text === choose)?.onPress?.();
      });
      await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
      await fireEvent.press(screen.getByRole("button", { name: "Sair" }));
      return { alert, forget };
    }

    it("tells the seller, stays signed in, and keeps every local record untouched", async () => {
      const logout = jest.fn(async () => {
        throw networkError();
      });
      const { alert, forget } = await signOutFailing(logout, null);
      await waitFor(() => expect(alert).toHaveBeenCalledWith("Não foi possível encerrar a sessão", expect.stringMatching(/continuar aberta.*pedidos salvos neste aparelho não serão apagados/s), expect.any(Array)));
      expect(forget).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("E-mail")).toBeNull(); // still signed in, no silent pretend sign-out
      expect(screen.getByRole("button", { name: "Sair" })).toBeTruthy();
      alert.mockRestore();
    });

    it("can be retried, and signs out once the server confirms", async () => {
      let calls = 0;
      const logout = jest.fn(async () => {
        calls += 1;
        if (calls === 1) throw networkError();
      });
      const { alert, forget } = await signOutFailing(logout, "Tentar novamente");
      expect(await screen.findByLabelText("E-mail")).toBeTruthy();
      expect(logout).toHaveBeenCalledTimes(2);
      expect(forget).toHaveBeenCalled();
      alert.mockRestore();
    });

    it("offers only Cancelar and Tentar novamente: there is no way to pretend the sign-out worked", async () => {
      const logout = jest.fn(async () => {
        throw networkError();
      });
      const { alert, forget } = await signOutFailing(logout, null);
      await waitFor(() => expect(alert).toHaveBeenCalledWith("Não foi possível encerrar a sessão", expect.any(String), expect.any(Array)));
      const failure = alert.mock.calls.find(([title]) => title === "Não foi possível encerrar a sessão");
      const labels = (failure?.[2] ?? []).map((button) => button.text);
      expect(labels).toEqual(["Cancelar", "Tentar novamente"]);
      expect((failure?.[2] ?? []).some((button) => button.style === "destructive")).toBe(false);
      expect(forget).not.toHaveBeenCalled();
      alert.mockRestore();
    });

    it("stays signed in after Cancelar and a later attempt can still succeed", async () => {
      let calls = 0;
      const logout = jest.fn(async () => {
        calls += 1;
        if (calls === 1) throw networkError();
      });
      const { alert, forget } = await signOutFailing(logout, "Cancelar");
      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
      expect(screen.queryByLabelText("E-mail")).toBeNull();
      expect(forget).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole("button", { name: "Sair" }));
      expect(await screen.findByLabelText("E-mail")).toBeTruthy();
      expect(logout).toHaveBeenCalledTimes(2);
      expect(forget).toHaveBeenCalled();
      alert.mockRestore();
    });
  });

  describe("retained (quarantined) orders", () => {
    const retained = {
      draft: draftRecord({ localId: "old-1", customerName: "Padaria Antiga", dataset: null, eligibility: "legacy_local", status: "needs_review", itemCount: 2 }),
      reason: "legacy_local" as const,
      canDiscard: true,
    };
    const attention: SyncStatus = { phase: "idle", pending: 0, needsAttention: 1, lastSyncedAt: null, lastError: null };
    const withRetained = () => fakeLocalOrders([], { listQuarantined: async () => [retained], countQuarantined: async () => 1 });

    it("is reachable from the sync panel in Perfil and lists the order with its reason", async () => {
      const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, attention, withRetained());
      await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
      await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Ver pedidos antigos retidos" }));
      expect(await screen.findByText("Padaria Antiga")).toBeTruthy();
      expect(screen.getByText("Criado antes da verificação de dados; não será enviado ao Force.")).toBeTruthy();
    });

    it("is reachable from the header sync sheet", async () => {
      const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, attention, withRetained());
      await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
      await fireEvent.press(await screen.findByRole("button", { name: /Status de sincronização/ }));
      await fireEvent.press(await screen.findByRole("button", { name: "Ver pedidos antigos retidos" }));
      expect(await screen.findByText("Padaria Antiga")).toBeTruthy();
    });

    it("does not show the entry when nothing is retained", async () => {
      const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
      await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
      await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
      expect(screen.queryByRole("button", { name: "Ver pedidos antigos retidos" })).toBeNull();
    });

    it("closes with Voltar and the Perfil is shown again", async () => {
      const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, attention, withRetained());
      await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
      await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Ver pedidos antigos retidos" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Voltar" }));
      await waitFor(() => expect(screen.queryByText("Padaria Antiga")).toBeNull());
    });
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

  it("keeps the catalog search and the Lista view when the seller leaves the tab and comes back", async () => {
    const products: ProductRepository = fakeProducts({ list: async () => pageOf([product(5, { description: "Copo 200 ml" })]) });
    await render(
      <Shell dependencies={fakeDependencies({ auth: signedIn(), repositories: { customers: { list: async () => pageOf([]) }, products, orders: fakeOrders() } })} />,
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Catálogo" }));
    await screen.findByText("Copo 200 ml");
    await fireEvent.changeText(screen.getByPlaceholderText("Buscar por código ou descrição"), "copo");
    await fireEvent.press(screen.getByRole("radio", { name: "Lista" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Catálogo" }));
    expect(screen.getByDisplayValue("copo")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Lista" }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();
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
    expect(await screen.findByText("Nenhuma venda pendente.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Minhas vendas" }).props.accessibilityState.selected).toBe(true);
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
