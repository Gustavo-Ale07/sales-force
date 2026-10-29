import { render, screen } from "@testing-library/react-native";
import type { LocalOrdersPort } from "../offline/local-orders";
import { draftRecord, fakeLocalOrders, fakeOrders, orderDetail } from "../test-doubles";
import { SaleDetailScreen } from "./sale-detail-screen";

const noop = () => undefined;

function renderDetail(localOrders: LocalOrdersPort) {
  return render(<SaleDetailScreen localId="x" localOrders={localOrders} connectivity="online" onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
}

describe("SaleDetailScreen loading", () => {
  it("shows a spinner with a label while the sale is being read, not a blank view", async () => {
    await renderDetail(fakeLocalOrders([], { open: () => new Promise(() => undefined) }));
    expect(screen.getByText("Carregando venda...")).toBeTruthy();
    expect(screen.getByLabelText("Carregando venda")).toBeTruthy();
  });

  it("replaces the loading state with the not-found message when the sale is gone", async () => {
    await renderDetail(fakeLocalOrders([], { open: async () => null }));
    expect(await screen.findByText("Esta venda não está mais neste aparelho.")).toBeTruthy();
    expect(screen.queryByText("Carregando venda...")).toBeNull();
  });
});

describe("SaleDetailScreen discount approval (M-14)", () => {
  const sent = draftRecord({ localId: "x", status: "synced", remoteId: "r-x", remoteVersion: 2, remoteDraftNumber: 9 });
  const rejected = orderDetail({
    id: "r-x",
    status: "approval_rejected",
    approval: { requestedLevel: "manager", requestedAt: "2026-10-01T10:00:00.000Z", decision: "rejected", decidedAt: "2026-10-01T11:00:00.000Z", decidedByName: "Marina Gerente", comment: "Desconto alto demais" },
  });

  it("shows the approver's decision and comment, read-only, for an order the server holds", async () => {
    const orders = fakeOrders({ get: async () => rejected });
    await render(<SaleDetailScreen localId="x" localOrders={fakeLocalOrders([sent], { open: async () => ({ draft: sent, lines: [] }) })} connectivity="online" orders={orders} onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
    expect(await screen.findByText("Desconto reprovado")).toBeTruthy();
    expect(screen.getByText("Decidido por Marina Gerente.")).toBeTruthy();
    expect(screen.getByText("Comentário: Desconto alto demais")).toBeTruthy();
    expect(screen.queryByLabelText("Aprovar")).toBeNull();
    expect(screen.queryByLabelText("Reprovar")).toBeNull();
  });

  it("does not read the server while offline and tolerates a failed read", async () => {
    let calls = 0;
    const orders = fakeOrders({ get: async () => { calls += 1; throw new Error("down"); } });
    await render(<SaleDetailScreen localId="x" localOrders={fakeLocalOrders([sent], { open: async () => ({ draft: sent, lines: [] }) })} connectivity="offline" orders={orders} onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
    expect(await screen.findByText("Enviado ao Force")).toBeTruthy();
    expect(calls).toBe(0);
    expect(screen.queryByText("Desconto reprovado")).toBeNull();
  });
});
