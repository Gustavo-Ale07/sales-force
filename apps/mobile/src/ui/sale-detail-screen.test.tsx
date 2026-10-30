import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { LocalOrdersPort } from "../offline/local-orders";
import { draftRecord, fakeLocalOrders, fakeOrders, orderDetail, orderEntryConfiguration } from "../test-doubles";
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

describe("SaleDetailScreen Compartilhar PDF", () => {
  const line = { key: "k", productCode: 1, description: "Cabo", unit: "RL", quantityText: "2,5", discountText: "", price: { state: "priced" as const, unitPrice: "10", tableCode: 1, versionId: 1 } };
  const draft = draftRecord({ localId: "x", status: "pending_sync", remoteDraftNumber: 3 });
  const open = () => fakeLocalOrders([draft], { open: async () => ({ draft, lines: [line] }) });

  it("shares the PDF built from local data, works while offline", async () => {
    const shared: string[] = [];
    const orderPdf = { sharePdf: async (html: string, name: string) => void shared.push(`${name}|${html.includes("Pedido Force nº 3")}`) };
    await render(<SaleDetailScreen localId="x" localOrders={open()} connectivity="offline" orderPdf={orderPdf} onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
    await fireEvent.press(await screen.findByLabelText("Compartilhar PDF"));
    await waitFor(() => expect(shared).toEqual(["pedido-3|true"]));
  });

  it("explains a failure in plain words", async () => {
    const orderPdf = { sharePdf: async () => { throw new Error("x"); } };
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await render(<SaleDetailScreen localId="x" localOrders={open()} connectivity="online" orderPdf={orderPdf} onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
    await fireEvent.press(await screen.findByLabelText("Compartilhar PDF"));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Não foi possível gerar o PDF", expect.stringContaining("Tente novamente")));
    alert.mockRestore();
  });

  it("has no button when the PDF port is absent", async () => {
    await render(<SaleDetailScreen localId="x" localOrders={open()} connectivity="online" onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
    await screen.findByText("Itens (1)");
    expect(screen.queryByLabelText("Compartilhar PDF")).toBeNull();
  });
});

describe("SaleDetailScreen in erp discount mode (D-L)", () => {
  it("hides the approval card when the installation releases discounts in Sankhya", async () => {
    const sent = draftRecord({ localId: "x", status: "synced", remoteId: "r-x", remoteVersion: 2, remoteDraftNumber: 9 });
    const awaiting = orderDetail({ id: "r-x", status: "awaiting_approval", approval: null });
    const base = orderEntryConfiguration();
    let reads = 0;
    const orders = fakeOrders({
      get: async () => { reads += 1; return awaiting; },
      getEntryConfiguration: async () => orderEntryConfiguration({ sales: { ...base.sales, discountAuthorityMode: "erp" } }),
    });
    await render(<SaleDetailScreen localId="x" localOrders={fakeLocalOrders([sent], { open: async () => ({ draft: sent, lines: [] }) })} connectivity="online" orders={orders} onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
    expect(await screen.findByText("Enviado ao Force")).toBeTruthy();
    await waitFor(() => expect(reads).toBe(1));
    expect(screen.queryByText("Aguardando aprovação do desconto")).toBeNull();
  });
});
