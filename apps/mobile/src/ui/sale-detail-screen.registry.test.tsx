import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { draftRecord, fakeLocalOrders } from "../test-doubles";
import { SaleDetailScreen } from "./sale-detail-screen";
import { renderWithModal } from "./test-modal-wrapper";

const noop = () => undefined;
const line = { key: "k", productCode: 1, description: "Cabo", unit: "RL", quantityText: "2", discountText: "", price: { state: "priced" as const, unitPrice: "10", tableCode: 1, versionId: 1 } };
const customer = {
  code: 1, name: "Cliente", tradeName: null, document: null, active: true, blocked: false, sellerCode: 1, sellerName: null, priceTableCode: 1,
  registry: { postalCode: "01310100", street: "Rua Registro Teste", number: "10", complement: null, neighborhood: "Bairro Teste", city: "Cidade Teste", state: "SP", mobile: null, phone: null, email: "cadastro@exemplo.test" },
  defaultCarrierCode: "7",
};

async function share(extra: { customers?: { cached: (code: number) => Promise<unknown> }; carriers?: { code: number; name: string }[] }) {
  const draft = draftRecord({ localId: "r1", status: "pending_sync", carrierCode: null });
  const shared: string[] = [];
  await renderWithModal(
    <SaleDetailScreen
      localId="r1"
      localOrders={fakeLocalOrders([draft], { open: async () => ({ draft, lines: [line] }) })}
      connectivity="offline"
      orderPdf={{ sharePdf: async (html) => void shared.push(html) }}
      {...(extra.customers === undefined ? {} : { customers: extra.customers as never })}
      {...(extra.carriers === undefined ? {} : { orders: { get: async () => { throw new Error("offline"); }, listCarriers: async () => extra.carriers ?? [] } })}
      onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop}
    />,
  );
  await fireEvent.press(await screen.findByLabelText("Compartilhar PDF"));
  await waitFor(() => expect(shared).toHaveLength(1));
  return shared[0] ?? "";
}

describe("SaleDetailScreen PDF: customer registry from the local mirror", () => {
  it("prints the cached registry and the customer's default carrier", async () => {
    const html = await share({ customers: { cached: async () => customer }, carriers: [{ code: 7, name: "Transportadora Padrao Teste" }] });
    expect(html).toContain("Rua Registro Teste");
    expect(html).toContain("cadastro@exemplo.test");
    expect(html).toContain("Transportadora Padrao Teste");
  });

  it("a customer missing from the cache (or a failing cache) still produces the PDF, with no invented data", async () => {
    const missing = await share({ customers: { cached: async () => null } });
    expect(missing).not.toContain("Rua Registro Teste");
    const failing = await share({ customers: { cached: async () => { throw new Error("db"); } } });
    expect(failing).not.toContain("Rua Registro Teste");
  });
});
