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
    onResumeDraft: jest.fn(),
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
    expect(screen.getByLabelText("Produtos disponíveis: 373")).toBeTruthy();
    expect(screen.getByLabelText("Pedidos locais: 1")).toBeTruthy();
    expect(screen.getByLabelText("Pendências de sincronização: 3")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Novo pedido" }));
    expect(props.onNewOrder).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(props.onSyncNow).toHaveBeenCalled();
  });

  it("resumes the most relevant draft and names its customer", async () => {
    const { props } = await renderHome({
      localOrders: localOrdersOf([
        draft("new", "Mercado Sul", "local_only", "2026-09-30T12:00:00Z"),
        draft("review", "Padaria Central", "needs_review", "2026-09-29T12:00:00Z", 1),
      ]),
    });
    expect(await screen.findByText("Padaria Central · 1 item")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Retomar pedido" }));
    expect(props.onResumeDraft).toHaveBeenCalledWith("review");
  });

  it("hides Retomar pedido when there is no draft, and never shows made-up performance numbers", async () => {
    await renderHome();
    await screen.findByLabelText("Clientes disponíveis: 250");
    expect(screen.queryByRole("button", { name: "Retomar pedido" })).toBeNull();
    expect(screen.getByText(/Indicadores comerciais ficarão disponíveis/)).toBeTruthy();
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
    await waitFor(() => expect(screen.getByLabelText("Produtos disponíveis: 5")).toBeTruthy());
    expect(screen.getByLabelText("Clientes disponíveis: indisponível")).toBeTruthy();
  });
});
