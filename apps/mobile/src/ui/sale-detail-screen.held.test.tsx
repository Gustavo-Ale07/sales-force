import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { CUSTOMER_BLOCK_MESSAGES, CUSTOMER_UNAVAILABLE_MESSAGE, LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE, PRODUCT_BLOCK_MESSAGES } from "@salesforce/mobile-db";
import type { DraftRecord } from "@salesforce/mobile-db";
import { draftRecord, fakeLocalOrders } from "../test-doubles";
import { SaleDetailScreen } from "./sale-detail-screen";
import { renderWithModal } from "./test-modal-wrapper";

const noop = () => undefined;
const line = { key: "k", productCode: 1, description: "Cabo", unit: "RL", quantityText: "2", discountText: "", price: { state: "priced" as const, unitPrice: "10", tableCode: 1, versionId: 1 } };

function show(draft: DraftRecord, extra: { onContinue?: (id: string) => void; orderPdf?: { sharePdf: (html: string, name: string) => Promise<void> } } = {}) {
  return renderWithModal(
    <SaleDetailScreen
      localId={draft.localId}
      localOrders={fakeLocalOrders([draft], { open: async () => ({ draft, lines: [line] }) })}
      connectivity="online"
      orderPdf={extra.orderPdf}
      onBack={noop}
      onChanged={noop}
      onContinue={extra.onContinue ?? noop}
      onDuplicate={noop}
      onSyncNow={noop}
    />,
  );
}

const dialog = () => screen.getByTestId("app-modal");

describe("SaleDetailScreen held order (customer unavailable)", () => {
  const held = draftRecord({ localId: "h1", status: "sync_error", lastError: CUSTOMER_UNAVAILABLE_MESSAGE });

  it("says so once when opened, with 'Trocar cliente' that continues the order", async () => {
    const onContinue = jest.fn();
    await show(held, { onContinue });
    const popup = await screen.findByTestId("app-modal");
    expect(within(popup).getByText("Cliente indisponível")).toBeTruthy();
    expect(within(popup).getByRole("button", { name: "Trocar cliente" })).toBeTruthy();
    expect(within(popup).getByRole("button", { name: "Fechar" })).toBeTruthy();
    await fireEvent.press(within(popup).getByRole("button", { name: "Trocar cliente" }));
    expect(onContinue).toHaveBeenCalledWith("h1");
    await waitFor(() => expect(screen.queryByTestId("app-modal")).toBeNull());
  });

  it("'Fechar' just closes the popup and does not announce it again", async () => {
    const onContinue = jest.fn();
    await show(held, { onContinue });
    await fireEvent.press(within(await screen.findByTestId("app-modal")).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByTestId("app-modal")).toBeNull());
    expect(onContinue).not.toHaveBeenCalled();
    // The sale detail itself stays on screen.
    expect(screen.getByRole("button", { name: "Voltar para Vendas" })).toBeTruthy();
  });

  it("the legacy stored text ('revise o rascunho') is recognized and gets the same popup", async () => {
    await show(draftRecord({ localId: "h2", status: "sync_error", lastError: LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE }));
    const popup = await screen.findByTestId("app-modal");
    expect(within(popup).getByRole("button", { name: "Trocar cliente" })).toBeTruthy();
  });

  it("a specific stored cause shows that cause", async () => {
    await show(draftRecord({ localId: "h3", status: "sync_error", lastError: CUSTOMER_BLOCK_MESSAGES.customer_without_seller }));
    const popup = await screen.findByTestId("app-modal");
    expect(within(popup).getByText("Cliente sem vendedor")).toBeTruthy();
    expect(within(popup).getByRole("button", { name: "Trocar cliente" })).toBeTruthy();
  });

  it("a blocked product shows its own popup without the 'Trocar cliente' action", async () => {
    await show(draftRecord({ localId: "h4", status: "sync_error", lastError: PRODUCT_BLOCK_MESSAGES.product_without_price }));
    const popup = await screen.findByTestId("app-modal");
    expect(within(popup).getByText("Produto sem preço")).toBeTruthy();
    expect(within(popup).queryByRole("button", { name: "Trocar cliente" })).toBeNull();
  });

  it("an ordinary order opens with no popup", async () => {
    await show(draftRecord({ localId: "n1", status: "pending_sync" }));
    await screen.findByText("Itens (1)");
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });

  it("sharing the PDF of a held order is refused with a popup (no PDF built) that offers 'Trocar cliente'", async () => {
    const sharePdf = jest.fn(async () => undefined);
    const onContinue = jest.fn();
    await show(held, { orderPdf: { sharePdf }, onContinue });
    await fireEvent.press(within(await screen.findByTestId("app-modal")).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByTestId("app-modal")).toBeNull());
    await fireEvent.press(await screen.findByLabelText("Compartilhar PDF"));
    const popup = await screen.findByTestId("app-modal");
    expect(within(popup).getByText("PDF não gerado")).toBeTruthy();
    expect(within(popup).getByRole("button", { name: "Trocar cliente" })).toBeTruthy();
    expect(sharePdf).not.toHaveBeenCalled();
    await fireEvent.press(within(dialog()).getByRole("button", { name: "Trocar cliente" }));
    expect(onContinue).toHaveBeenCalledWith("h1");
  });
});
