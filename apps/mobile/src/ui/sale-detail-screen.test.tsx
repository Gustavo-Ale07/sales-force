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

describe("SaleDetailScreen Duplicar como pedido (D-B)", () => {
  const base = orderEntryConfiguration();
  const config = orderEntryConfiguration({ sales: { ...base.sales, orderTops: { defaultTopCode: 1001, quotationTopCode: 1000, eligibleTopCodes: [1000, 1001] } } });
  const quotation = draftRecord({ localId: "x", status: "synced", remoteId: "r-x", topCode: 1000, remoteDraftNumber: 4 });
  const orders = fakeOrders({ getEntryConfiguration: async () => config, get: async () => orderDetail({ id: "r-x", topCode: 1000 }) });
  const show = (draft: typeof quotation, localOrders: Partial<LocalOrdersPort>, connectivity: "online" | "offline" = "online", onContinue = noop) =>
    render(<SaleDetailScreen localId="x" localOrders={fakeLocalOrders([draft], { open: async () => ({ draft, lines: [] }), ...localOrders })} connectivity={connectivity} orders={orders} onBack={noop} onChanged={noop} onContinue={onContinue} onDuplicate={noop} onSyncNow={noop} />);

  it("is offered for a sent quotation, labels the operation, and opens the new order", async () => {
    const onContinue = jest.fn();
    const duplicateAsOrder = jest.fn(async () => ({ ok: true as const, localId: "new-1", skippedLines: [] }));
    await show(quotation, { duplicateAsOrder }, "online", onContinue);
    expect(await screen.findByText("Operação: Cotação (TOP 1000)")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Duplicar como pedido" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith("new-1"));
    expect(duplicateAsOrder).toHaveBeenCalledWith("x");
  });

  it("reports the lines left out before opening the new order", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await show(quotation, { duplicateAsOrder: async () => ({ ok: true as const, localId: "new-1", skippedLines: [{ lineNo: 1, productCode: 12, reason: "no_price" }] }) });
    fireEvent.press(await screen.findByRole("button", { name: "Duplicar como pedido" }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Pedido criado com itens a menos", expect.stringContaining("Produto 12 (sem preço)"), expect.any(Array)));
    alert.mockRestore();
  });

  it("shows the refusal text and stays on the quotation", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const onContinue = jest.fn();
    await show(quotation, { duplicateAsOrder: async () => ({ ok: false as const, failure: { title: "Não foi possível duplicar como pedido", message: "A cotação foi cancelada e não pode ser duplicada.", skipped: [] } }) }, "online", onContinue);
    fireEvent.press(await screen.findByRole("button", { name: "Duplicar como pedido" }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Não foi possível duplicar como pedido", "A cotação foi cancelada e não pode ser duplicada."));
    expect(onContinue).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("is disabled with a hint while offline and absent for a regular order", async () => {
    await show(quotation, {}, "offline");
    expect(await screen.findByText("Conecte-se à internet para duplicar a cotação como pedido.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Duplicar como pedido" }).props.accessibilityState.disabled).toBe(true);
  });

  it("is not offered for an order that is not a quotation", async () => {
    const regular = { ...quotation, topCode: 1001 };
    await render(<SaleDetailScreen localId="x" localOrders={fakeLocalOrders([regular], { open: async () => ({ draft: regular, lines: [] }) })} connectivity="online" orders={fakeOrders({ getEntryConfiguration: async () => config, get: async () => orderDetail({ id: "r-x", topCode: 1001 }) })} onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
    expect(await screen.findByText("Operação: Pedido (TOP 1001)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Duplicar como pedido" })).toBeNull();
  });
});
