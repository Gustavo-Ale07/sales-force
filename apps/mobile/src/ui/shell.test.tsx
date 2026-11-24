import { fillMandatoryHeader } from "./fill-mandatory-header";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { BackHandler } from "react-native";
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
  unsent = 0,
) {
  const syncNow = jest.fn(async () => status);
  const sync: SyncManager = {
    sync: syncNow,
    getStatus: () => status,
    subscribe: () => () => undefined,
    refresh: async () => status,
  };
  const forget = jest.fn(async () => undefined);
  const endSession = jest.fn(async () => ({ cleared: unsent === 0, unsent }));
  const offline: OfflineServices = {
    unsentWork: async () => unsent,
    endSession,
    wipeAll: async () => undefined,
    session: { load: async () => remembered, remember: async () => undefined, forget },
    forAccount: () => ({
      repositories,
      localOrders,
      pendingCustomers: { create: jest.fn(), redo: jest.fn(), creationAvailable: async () => true, list: async () => [], resend: async () => undefined, discard: async () => undefined },
      sync,
      ...(productImages === undefined ? {} : { productImages }),
    }),
  };
  return { offline, forget, syncNow, endSession };
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
  await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
  await fireEvent.press(screen.getByRole("button", { name: "Sair" }));
  await pressInModal("Sair");
}

/** The in-app dialog replaced the native Alert: its buttons live inside `app-modal`. */
async function pressInModal(label: string) {
  const dialog = await screen.findByTestId("app-modal");
  await fireEvent.press(within(dialog).getByRole("button", { name: label }));
}

describe("Shell", () => {
  it("shows the login form when there is no session", async () => {
    await render(<Shell dependencies={fakeDependencies()} />);
    expect(await screen.findByLabelText("Usuário")).toBeTruthy();
  });

  it("falls back to the login form when the session probe cannot reach the server", async () => {
    const auth = fakeAuth({
      getSession: async () => {
        throw networkError();
      },
    });
    await render(<Shell dependencies={fakeDependencies({ auth })} />);
    expect(await screen.findByLabelText("Usuário")).toBeTruthy();
  });

  it("opens offline with the remembered account when the server is unreachable", async () => {
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: unreachable(), offline })} />);
    expect(await screen.findByText("Olá, Ana Vendedora")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Vendas" })).toBeTruthy();
    expect(screen.getByLabelText("Status de sincronização: Sincronizado")).toBeTruthy();
    expect(screen.queryByText("Online")).toBeNull();
  });

  it("asks for an online login when the remembered account is older than the offline window", async () => {
    const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { offline } = fakeOffline({ account, lastOnlineAt: stale });
    await render(<Shell dependencies={fakeDependencies({ auth: unreachable(), offline })} />);
    expect(await screen.findByLabelText("Usuário")).toBeTruthy();
  });

  it("forgets the remembered account on sign-out", async () => {
    const { offline, forget } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await signOutFromProfile();
    await waitFor(() => expect(forget).toHaveBeenCalled());
  });

  describe("sign-out and the local cache (owner 2026-11-13)", () => {
    const confirmText = async (unsent: number) => {
      const { offline, endSession } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, undefined, undefined, undefined, undefined, unsent);
      await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
      await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
      await fireEvent.press(screen.getByRole("button", { name: "Sair" }));
      const dialog = await screen.findByTestId("app-modal");
      // The only text node of the dialog other than the title and the buttons is the message.
      const message = within(dialog).getByText(/serão apagados|ainda não enviado/).props.children as string;
      await pressInModal("Sair");
      await waitFor(() => expect(endSession).toHaveBeenCalled());
      return { message, endSession };
    };

    it("nothing unsent: says the downloaded data is cleared, and asks the services to clear it for this account", async () => {
      const { message, endSession } = await confirmText(0);
      expect(message).toMatch(/serão apagados/);
      expect(endSession).toHaveBeenCalledWith(account.id);
    });

    it("something unsent: warns how many were not sent and that they stay on the device", async () => {
      const { message } = await confirmText(3);
      expect(message).toContain("3 itens ainda não enviados");
      expect(message).toMatch(/continuam salvos/);
    });

    it("one unsent item is singular", async () => {
      const { message } = await confirmText(1);
      expect(message).toContain("1 item ainda não enviado");
    });
  });

  describe("full sync only on a real login", () => {
    it("reopening the app with a valid session never runs the login sync", async () => {
      const { offline, syncNow } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
      await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
      expect(await screen.findByText("Olá, Ana Vendedora")).toBeTruthy();
      expect(syncNow).not.toHaveBeenCalledWith("login");
    });

    it("signing in on the login screen runs the login sync", async () => {
      const { offline, syncNow } = fakeOffline(null);
      await render(<Shell dependencies={fakeDependencies({ auth: fakeAuth(), offline })} />);
      await fireEvent.changeText(await screen.findByLabelText("Usuário"), "ana");
      await fireEvent.changeText(screen.getByLabelText("Senha"), "segredo-123");
      await fireEvent.press(screen.getByRole("button", { name: "Entrar" }));
      await waitFor(() => expect(syncNow).toHaveBeenCalledWith("login"));
    });
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
      expect(await screen.findByLabelText("Usuário")).toBeTruthy();
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
    expect(await screen.findByLabelText("Usuário")).toBeTruthy();
  });

  describe("when the server logout fails", () => {
    /** Presses Sair, confirms the sign-out dialog, and answers the failure popup with the button `choose` (if any). */
    async function signOutFailing(logout: jest.Mock, choose: string | null) {
      const auth = fakeAuth({ getSession: async () => account, logout });
      const { offline, forget } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
      await render(<Shell dependencies={fakeDependencies({ auth, offline })} />);
      await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
      await fireEvent.press(screen.getByRole("button", { name: "Sair" }));
      await pressInModal("Sair");
      await waitFor(() => expect(logout).toHaveBeenCalled());
      if (choose !== null) await pressInModal(choose);
      return { forget };
    }

    it("tells the seller, stays signed in, and keeps every local record untouched", async () => {
      const logout = jest.fn(async () => {
        throw networkError();
      });
      const { forget } = await signOutFailing(logout, null);
      expect(await screen.findByText("Não foi possível sair")).toBeTruthy();
      expect(screen.getByText(/continuar aberta.*pedidos salvos não serão apagados/s)).toBeTruthy();
      expect(forget).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Usuário")).toBeNull(); // still signed in, no silent pretend sign-out
      expect(screen.getByRole("button", { name: "Sair" })).toBeTruthy();
    });

    it("can be retried, and signs out once the server confirms", async () => {
      let calls = 0;
      const logout = jest.fn(async () => {
        calls += 1;
        if (calls === 1) throw networkError();
      });
      const { forget } = await signOutFailing(logout, null);
      await screen.findByText("Não foi possível sair");
      await pressInModal("Tentar de novo");
      expect(await screen.findByLabelText("Usuário")).toBeTruthy();
      expect(logout).toHaveBeenCalledTimes(2);
      expect(forget).toHaveBeenCalled();
    });

    it("offers only Tentar de novo and Fechar: there is no way to pretend the sign-out worked", async () => {
      const logout = jest.fn(async () => {
        throw networkError();
      });
      const { forget } = await signOutFailing(logout, null);
      const dialog = await screen.findByTestId("app-modal");
      const labels = within(dialog).getAllByRole("button").map((button) => button.props.accessibilityLabel).filter((label) => label !== undefined); // "Ver detalhes" has no label
      expect(labels).toEqual(["Tentar de novo", "Fechar"]);
      expect(forget).not.toHaveBeenCalled();
    });

    it("stays signed in after Fechar and a later attempt can still succeed", async () => {
      let calls = 0;
      const logout = jest.fn(async () => {
        calls += 1;
        if (calls === 1) throw networkError();
      });
      const { forget } = await signOutFailing(logout, null);
      await screen.findByText("Não foi possível sair");
      await pressInModal("Fechar");
      await waitFor(() => expect(screen.queryByTestId("app-modal")).toBeNull());
      expect(logout).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText("Usuário")).toBeNull();
      expect(forget).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole("button", { name: "Sair" }));
      await pressInModal("Sair");
      expect(await screen.findByLabelText("Usuário")).toBeTruthy();
      expect(logout).toHaveBeenCalledTimes(2);
      expect(forget).toHaveBeenCalled();
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
      // a short tap only syncs; the popup opens on long press (or when the indicator is red)
      await fireEvent(await screen.findByRole("button", { name: /Status de sincronização/ }), "longPress");
      await fireEvent.press(await screen.findByRole("button", { name: "Ver detalhes" }));
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
    expect(await screen.findByLabelText("Status de sincronização: Sincronizado")).toBeTruthy();
    expect(screen.queryByText(/Exibindo os dados salvos neste aparelho/)).toBeNull();

    await act(async () => connectivity.emit("offline"));
    await waitFor(() => expect(screen.getByLabelText("Status de sincronização: Sem conexão")).toBeTruthy());
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

  it("Clientes resets to its list when the seller leaves the tab: an open customer sheet is closed", async () => {
    const customers: CustomerRepository = {
      list: async (request) => (request.pageSize === 1 ? pageOf([]) : pageOf([customer(1, { name: "Mercado Sul" })])),
    };
    await render(
      <Shell dependencies={fakeDependencies({ auth: signedIn(), repositories: { customers, products: fakeProducts(), orders: fakeOrders() } })} />,
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
    await fireEvent.press(await screen.findByRole("button", { name: /Mercado Sul/ }));
    expect(await screen.findByRole("button", { name: "Voltar para Clientes" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Clientes" }));
    expect(screen.queryByRole("button", { name: "Voltar para Clientes" })).toBeNull();
    expect(await screen.findByText("Mercado Sul")).toBeTruthy();
  });

  it("Clientes resets its search when the seller leaves the tab", async () => {
    const customers: CustomerRepository = { list: async (request) => (request.pageSize === 1 ? pageOf([]) : pageOf([customer(1, { name: "Mercado Sul" })])) };
    await render(
      <Shell dependencies={fakeDependencies({ auth: signedIn(), repositories: { customers, products: fakeProducts(), orders: fakeOrders() } })} />,
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
    await screen.findByText("Mercado Sul");
    await fireEvent.changeText(screen.getByLabelText(/Buscar/), "sul");
    await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Clientes" }));
    expect(screen.queryByDisplayValue("sul")).toBeNull();
  });

  it("Catálogo resets its search and view when the seller leaves the tab", async () => {
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
    expect(screen.queryByDisplayValue("copo")).toBeNull();
    expect(screen.getByRole("radio", { name: "Lista" }).props.accessibilityState.checked).toBe(false);
    expect(await screen.findByText("Copo 200 ml")).toBeTruthy();
  });

  it("shows the account, version and a real manual sync in Perfil", async () => {
    const pending: SyncStatus = { phase: "idle", pending: 2, needsAttention: 0, lastSyncedAt: "2026-09-30T15:30:00.000Z", lastError: null };
    const { offline, syncNow } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, pending);
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
    expect(screen.getAllByText("Vendedor").length).toBeGreaterThan(0);
    expect(screen.getByText("ana.vendas")).toBeTruthy();
    expect(screen.getByText("Versão")).toBeTruthy();
    expect(screen.getByText("Alterações pendentes")).toBeTruthy();
    syncNow.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(syncNow).toHaveBeenCalledWith("manual");
  });

  it("Vendas opens on 'Minhas vendas' with ONE entry, the 'Nova venda' button", async () => {
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Vendas" }));
    expect(await screen.findByText("Nenhuma venda pendente.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Nova venda" })).toHaveLength(1);
    expect(screen.queryByText("Novo pedido")).toBeNull();
  });

  it("an order in progress is saved as 'Salvo no aparelho' when the seller switches tab, and Vendas comes back on its list", async () => {
    const localOrders = fakeLocalOrders();
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, undefined, localOrders);
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Vendas" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Nova venda" }));
    expect(screen.getByLabelText("Etapa 1 de 4: Cliente")).toBeTruthy();
    // An empty order is never written.
    await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Perfil" }).props.accessibilityState.selected).toBe(true));
    expect(localOrders.drafts).toHaveLength(0);
    await fireEvent.press(screen.getByRole("tab", { name: "Vendas" }));
    expect(await screen.findByRole("button", { name: "Nova venda" })).toBeTruthy();
    expect(screen.queryByLabelText("Etapa 1 de 4: Cliente")).toBeNull();
  });

  it("inside the order wizard the header X leaves to Minhas vendas without a question (nothing to save yet)", async () => {
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() });
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Vendas" }));
    await screen.findByText("Nenhuma venda pendente.");
    await fireEvent.press(screen.getByRole("button", { name: "Nova venda" }));
    expect(screen.getByLabelText("Etapa 1 de 4: Cliente")).toBeTruthy();
    // Empty order: leaves without a question and writes nothing.
    await fireEvent.press(screen.getByRole("button", { name: "Sair do pedido" }));
    expect(await screen.findByRole("button", { name: "Nova venda" })).toBeTruthy();
    expect(screen.queryByLabelText("Etapa 1 de 4: Cliente")).toBeNull();
  });

  it("switching tab with an unsaved order asks once; the tab changes only after 'Descartar', and 'Continuar editando' stays", async () => {
    const customers: CustomerRepository = {
      list: async (request) => (request.pageSize === 1 ? pageOf([]) : pageOf([customer(10, { name: "Padaria Central", document: "12345678000190" })])),
    };
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, undefined, fakeLocalOrders(), undefined, { customers, products: fakeProducts({ list: async () => pageOf([]) }), orders: fakeOrders() });
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline, repositories: { customers, products: fakeProducts({ list: async () => pageOf([]) }), orders: fakeOrders() } })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
    await fireEvent.press(await screen.findByRole("button", { name: /Padaria Central, código 10/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "Novo pedido" }));
    await screen.findByLabelText(/^Etapa 2 de 4/);
    await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    expect(await screen.findByLabelText("Descartar o pedido?")).toBeTruthy();
    expect(screen.getAllByLabelText("Descartar o pedido?")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Vendas" }).props.accessibilityState.selected).toBe(true);
    await pressInModal("Continuar editando");
    expect(screen.getByRole("tab", { name: "Vendas" }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    await screen.findByLabelText("Descartar o pedido?");
    await pressInModal("Descartar");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Perfil" }).props.accessibilityState.selected).toBe(true));
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
    // The customer is already chosen: the order opens on Negociação; Próximo reaches the catalog.
    await fillMandatoryHeader();
    await fireEvent.press(await screen.findByRole("button", { name: "Próximo" }));
    expect(await screen.findByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Vendas" }).props.accessibilityState.selected).toBe(true);
  });
});

describe("Shell: Android Back", () => {
  const handlers: Array<() => boolean> = [];
  let exitApp: jest.SpyInstance;
  beforeEach(() => {
    handlers.length = 0;
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
      handlers.push(handler as () => boolean);
      return { remove: () => { const index = handlers.indexOf(handler as () => boolean); if (index >= 0) handlers.splice(index, 1); } };
    });
    exitApp = jest.spyOn(BackHandler, "exitApp").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  /** Presses the hardware Back: the most recently registered handler answers first, like the real BackHandler. */
  async function back() {
    await act(async () => {
      for (let i = handlers.length - 1; i >= 0; i -= 1) if (handlers[i]?.() === true) break;
    });
  }

  it("on a tab other than Início, Back goes to Início", async () => {
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn() })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Catálogo" }));
    await back();
    expect(screen.getByRole("tab", { name: "Início" }).props.accessibilityState.selected).toBe(true);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("on Início the first Back shows 'Toque de novo para sair' (not an alert) and the second within 2 s exits", async () => {
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn() })} />);
    await screen.findByText("Olá, Ana Vendedora");
    await back();
    expect(await screen.findByText("Toque de novo para sair")).toBeTruthy();
    expect(exitApp).not.toHaveBeenCalled();
    await back();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("an open customer sheet closes with Back before leaving the tab", async () => {
    const customers: CustomerRepository = { list: async (request) => (request.pageSize === 1 ? pageOf([]) : pageOf([customer(1, { name: "Mercado Sul" })])) };
    await render(
      <Shell dependencies={fakeDependencies({ auth: signedIn(), repositories: { customers, products: fakeProducts(), orders: fakeOrders() } })} />,
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Clientes" }));
    await fireEvent.press(await screen.findByRole("button", { name: /Mercado Sul/ }));
    await screen.findByRole("button", { name: "Voltar para Clientes" });
    await back();
    expect(screen.queryByRole("button", { name: "Voltar para Clientes" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Clientes" }).props.accessibilityState.selected).toBe(true);
  });

  it("inside the order wizard Back on step 1 leaves an empty order with no question (nothing is written) and lands on Minhas vendas", async () => {
    const localOrders = fakeLocalOrders();
    const { offline } = fakeOffline({ account, lastOnlineAt: new Date().toISOString() }, undefined, localOrders);
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), offline })} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Vendas" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Nova venda" }));
    expect(screen.getByLabelText("Etapa 1 de 4: Cliente")).toBeTruthy();
    await back();
    expect(await screen.findByRole("button", { name: "Nova venda" })).toBeTruthy();
    expect(localOrders.drafts).toHaveLength(0);
  });
});
