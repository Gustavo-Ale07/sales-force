import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { DraftRecord, SyncStatus } from "@salesforce/mobile-db";
import type { LocalOrdersPort } from "../offline/local-orders";
import { account, fakeLocalOrders, pageOf } from "../test-doubles";
import { HomeScreen, type HomeScreenProps } from "./home-screen";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

function draft(localId: string, customerName: string, status: DraftRecord["status"], updatedAt: string, itemCount = 2): DraftRecord {
  return {
    localId,
    ownerAccountId: account.id,
    clientRequestId: `r-${localId}`,
    customerCode: 1,
    customerName,
    negotiationTypeCode: null,
    topCode: null,
    carrierCode: null, freightType: null,
    notes: null,
    status,
    remoteId: null,
    remoteVersion: null,
    remoteDraftNumber: null,
    estimatedTotal: null,
    lastError: null,
    priceReview: null,
    serverSnapshot: null,
    createdAt: updatedAt,
    updatedAt,
    itemCount,
    dataset: { environment: "production", datasetId: "mirror-real-001" },
    eligibility: "eligible",
    sendState: null,
    sendCode: null,
    sendError: null,
    sendAttempts: 0,
    sendNextAttemptAt: null,
    sendRequestedAt: null,
    erpStage: null,
    erpNumber: null,
    discountOverLimitAccepted: false,
  };
}

function localOrdersOf(drafts: DraftRecord[]): LocalOrdersPort {
  return fakeLocalOrders(drafts);
}

async function renderHome(overrides: Partial<HomeScreenProps> = {}) {
  const repositories = {
    customers: { list: async () => pageOf([], 250) },
    products: { list: async () => pageOf([], 373) } as never,
  };
  const props: HomeScreenProps = {
    account,
    active: true,
    repositories,
    localOrders: localOrdersOf([]),
    syncStatus: idle,
    connectivity: "online",
    onNewOrder: jest.fn(),
    onSyncNow: jest.fn(),
    ...overrides,
  };
  await render(<HomeScreen {...props} />);
  return { props };
}

describe("HomeScreen", () => {
  it("shows the real local counters and the quick actions", async () => {
    const { props } = await renderHome({
      localOrders: localOrdersOf([draft("a", "Padaria Central", "local_only", "2026-09-30T10:00:00Z", 1)]),
      syncStatus: { ...idle, pending: 2, needsAttention: 1 },
    });
    expect(await screen.findByLabelText("Clientes disponíveis: 250")).toBeTruthy();
    expect(screen.getByLabelText("Produtos no aparelho: 373")).toBeTruthy();
    expect(screen.getByLabelText("Pedidos locais: 1")).toBeTruthy();
    expect(screen.getByLabelText("Pendências de sincronização: 3")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Novo pedido" }));
    expect(props.onNewOrder).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(props.onSyncNow).toHaveBeenCalled();
  });

  it("offers no Retomar pedido shortcut (Vendas lists the drafts), and never shows made-up performance numbers", async () => {
    await renderHome();
    await screen.findByLabelText("Clientes disponíveis: 250");
    expect(screen.queryByRole("button", { name: "Retomar pedido" })).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("says that syncing needs a connection instead of pretending to work offline", async () => {
    const { props } = await renderHome({ connectivity: "offline" });
    await screen.findByLabelText("Clientes disponíveis: 250");
    expect(screen.getByText("Requer conexão com a internet")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(props.onSyncNow).not.toHaveBeenCalled();
  });

  it("shows a dash, not zero, for a counter that could not be read", async () => {
    await renderHome({
      repositories: {
        customers: {
          list: async () => {
            throw new Error("boom");
          },
        },
        products: { list: async () => pageOf([], 5) } as never,
      },
    });
    await waitFor(() => expect(screen.getByLabelText("Produtos no aparelho: 5")).toBeTruthy());
    expect(screen.getByLabelText("Clientes disponíveis: indisponível")).toBeTruthy();
  });

  it("shows the site's five counters from the server, with \"—\" for what it did not deliver", async () => {
    const dashboard = { load: async () => ({ customers: "1.250", products: "373", sellable: "300", openOrders: "4", unsentAmount: null, portfolio: [] }) };
    await renderHome({ dashboard });
    expect(await screen.findByLabelText("Clientes: 1.250")).toBeTruthy();
    expect(screen.getByLabelText("Produtos: 373")).toBeTruthy();
    expect(screen.getByLabelText("Vendáveis: 300")).toBeTruthy();
    expect(screen.getByLabelText("Pedidos em aberto: 4")).toBeTruthy();
    expect(screen.getByLabelText("R$ não enviados: indisponível")).toBeTruthy();
  });

  it("offline asks nothing and says the counters come back with the internet", async () => {
    const load = jest.fn(async () => ({ customers: "1", products: "1", sellable: "1", openOrders: "1", unsentAmount: "1", portfolio: [] }));
    await renderHome({ dashboard: { load }, connectivity: "offline" });
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText(/Sem conexão: os indicadores voltam/)).toBeTruthy();
  });
});
