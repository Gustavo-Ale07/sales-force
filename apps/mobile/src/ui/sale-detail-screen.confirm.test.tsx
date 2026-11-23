import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ConfirmOutcome, DraftRecord } from "@salesforce/mobile-db";
import { draftRecord, fakeLocalOrders } from "../test-doubles";
import { SaleDetailScreen } from "./sale-detail-screen";
import { renderWithModal } from "./test-modal-wrapper";

const noop = () => undefined;
const line = { key: "k", productCode: 1, description: "Cabo", unit: "RL", quantityText: "2", discountText: "", price: { state: "priced" as const, unitPrice: "10", tableCode: 1, versionId: 1 } };

/** A detail screen over a mutable draft: `requestSend` / `confirm` doubles move it the way the real engine would. */
async function show(initial: DraftRecord, confirm: (id: string) => Promise<ConfirmOutcome>, extra: { onContinue?: (id: string) => void; orderPdf?: { sharePdf: (html: string, name: string) => Promise<void> } } = {}) {
  let current = initial;
  const requestSend = jest.fn(async (_id: string) => {
    current = { ...current, sendState: "requested", status: "pending_sync" };
  });
  const confirmSpy = jest.fn(confirm);
  const localOrders = fakeLocalOrders([initial], { open: async () => ({ draft: current, lines: [line] }), requestSend, confirm: confirmSpy });
  await renderWithModal(
    <SaleDetailScreen localId={initial.localId} localOrders={localOrders} connectivity="online" orderPdf={extra.orderPdf} onBack={noop} onChanged={noop} onContinue={extra.onContinue ?? noop} onDuplicate={noop} onSyncNow={noop} />,
  );
  return {
    requestSend,
    confirm: confirmSpy,
    settle: (next: Partial<DraftRecord>) => {
      current = { ...current, ...next };
    },
  };
}

const unconfirmed = draftRecord({ localId: "u1", status: "local_only", remoteDraftNumber: 12 });

describe("SaleDetailScreen Confirmar", () => {
  it("an unconfirmed order has ONE primary 'Confirmar' next to 'Continuar pedido', and no 'Salvar'/'Enviar'", async () => {
    await show(unconfirmed, async () => ({ kind: "queued" }));
    expect(await screen.findByRole("button", { name: "Confirmar" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Confirmar" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Continuar pedido" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Salvar|Enviar/ })).toBeNull();
    expect(screen.getByText("Em andamento")).toBeTruthy();
  });

  it("Confirmar asks for the send, delivers it and reports a queued order with the 'não enviado' popup", async () => {
    const { requestSend, confirm } = await show(unconfirmed, async () => ({ kind: "queued" }));
    await act(async () => {
      fireEvent.press(await screen.findByRole("button", { name: "Confirmar" }));
    });
    expect(await screen.findByText("Pedido não enviado ao Sankhya")).toBeTruthy();
    expect(requestSend).toHaveBeenCalledWith("u1");
    expect(confirm).toHaveBeenCalledWith("u1");
    expect(requestSend.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0] ?? 0);
  });

  it("a double tap while delivering sends once (button shows 'Enviando ao Sankhya' and is disabled)", async () => {
    let release: (value: ConfirmOutcome) => void = noop;
    const { requestSend, confirm } = await show(unconfirmed, () => new Promise<ConfirmOutcome>((resolve) => (release = resolve)));
    const button = await screen.findByRole("button", { name: "Confirmar" });
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(await screen.findByText("Enviando ao Sankhya")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar" }).props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      release({ kind: "sent", erpNumber: 5 });
    });
    expect(requestSend).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("after the order reaches Sankhya it is read-only: no Confirmar, Continuar or Excluir", async () => {
    let settle: (next: Partial<DraftRecord>) => void = noop;
    const ctl = await show(unconfirmed, async () => {
      settle({ status: "synced", remoteId: "r-u1", remoteVersion: 1, sendState: "submitted", sendCode: "sent" });
      return { kind: "sent", erpNumber: 5 };
    });
    settle = ctl.settle;
    await act(async () => {
      fireEvent.press(await screen.findByRole("button", { name: "Confirmar" }));
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Continuar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir pedido" })).toBeNull();
    expect(screen.getByText("Enviado ao Sankhya")).toBeTruthy();
    expect(screen.queryByText("Pedido não enviado ao Sankhya")).toBeNull();
  });

  it("a definitive refusal (customer without seller) opens a popup with 'Trocar cliente' once and the button becomes 'Tentar de novo'", async () => {
    const onContinue = jest.fn();
    const refused = draftRecord({ localId: "r1", status: "synced", remoteId: "r-r1", remoteVersion: 1, sendState: "refused", sendCode: "customer_without_seller", sendError: "Este cliente não tem vendedor vinculado." });
    const { confirm } = await show(refused, async () => ({ kind: "queued" }), { onContinue });
    expect(await screen.findByText("Cliente sem vendedor")).toBeTruthy();
    expect(screen.getAllByText("Cliente sem vendedor")).toHaveLength(1);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Trocar cliente" }));
    });
    expect(onContinue).toHaveBeenCalledWith("r1");
  });

  it("discount_blocked and erp_submission_disabled refusals each get their own popup", async () => {
    const blocked = draftRecord({ localId: "b1", status: "synced", remoteId: "r-b1", sendState: "refused", sendCode: "discount_blocked" });
    await show(blocked, async () => ({ kind: "queued" }));
    expect(await screen.findByText("Desconto bloqueado")).toBeTruthy();
  });

  it("erp_submission_disabled", async () => {
    const off = draftRecord({ localId: "d1", status: "synced", remoteId: "r-d1", sendState: "refused", sendCode: "erp_submission_disabled" });
    await show(off, async () => ({ kind: "queued" }));
    expect(await screen.findByText("Envio ao Sankhya desligado")).toBeTruthy();
  });

  it("the PDF file name falls back to 'pedido' while the order has no number", async () => {
    const shared: string[] = [];
    const orderPdf = { sharePdf: async (_html: string, name: string) => void shared.push(name) };
    await show(draftRecord({ localId: "n1", status: "local_only", remoteDraftNumber: null }), async () => ({ kind: "queued" }), { orderPdf });
    await act(async () => {
      fireEvent.press(await screen.findByLabelText("Compartilhar PDF"));
    });
    await waitFor(() => expect(shared).toEqual(["pedido"]));
  });
});
