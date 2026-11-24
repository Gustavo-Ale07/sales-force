import { CUSTOMER_BLOCK_MESSAGES, CUSTOMER_UNAVAILABLE_MESSAGE, LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE, PRODUCT_BLOCK_MESSAGES, type DraftRecord } from "@salesforce/mobile-db";
import { draftRecord } from "../test-doubles";
import type { EditorLine } from "../data/order-draft";
import { buildOrderPdfHtml, orderDocumentOf, OrderPdfCustomerUnavailableError, pdfStatusLabelOf, shareOrderPdf, type OrderPdfPort } from "./order-pdf";

const line = (over: Partial<EditorLine> = {}): EditorLine => ({
  key: "k1",
  productCode: 2001,
  description: "Cabo <flexível> 2,5mm",
  unit: "RL",
  quantityText: "1,2345",
  discountText: "10",
  price: { state: "priced", unitPrice: "10", tableCode: 5, versionId: 9 },
  ...over,
});
const noPrice = (): EditorLine =>
  line({ key: "k2", productCode: 2002, description: "Sem tabela", quantityText: "2", discountText: "", price: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" } });

describe("orderDocumentOf", () => {
  const draft = draftRecord({ remoteDraftNumber: 42, notes: "Entregar cedo", customerName: "Padaria Central", status: "pending_sync" });

  it("maps the local order with decimal quantities, totals from the domain and a Sankhya-worded state", () => {
    const model = orderDocumentOf(draft, [line(), noPrice()]);
    expect(model).not.toHaveProperty("draftNumber");
    expect(model.erpNumber).toBeNull();
    expect(model.items[0]).toMatchObject({ quantity: "1.2345", unitListPrice: "10", discountPercent: "10", productDescription: "Cabo <flexível> 2,5mm" });
    expect(model.items[1]).toMatchObject({ unitListPrice: null, estimatedLineTotal: null, quantity: "2" });
    expect(model.totals.isPartial).toBe(true);
    expect(model.totals.unpricedLineCount).toBe(1);
    expect(model.statusLabel).not.toMatch(/ERP/);
  });

  it("takes the Sankhya number from the server snapshot only when it is a number", () => {
    expect(orderDocumentOf(draftRecord({ serverSnapshot: { erpNumber: 987 } }), [line()]).erpNumber).toBe(987);
    expect(orderDocumentOf(draftRecord({ serverSnapshot: { erpNumber: "x" } }), [line()]).erpNumber).toBeNull();
  });

  it("never carries cost, margin or other snapshot fields into the document", () => {
    const tainted = draftRecord({ serverSnapshot: { erpNumber: 5, cost: "777.01", margin: "31", items: [{ unitCost: "8.88" }] } });
    const html = buildOrderPdfHtml(tainted, [line()], "data:image/png;base64,AAAA");
    expect(html).not.toContain("777");
    expect(html).not.toContain("8,88");
    expect(JSON.stringify(orderDocumentOf(tainted, [line()]))).not.toMatch(/cost|margin|777/i);
  });

  it("escapes values in the HTML and formats pt-BR", () => {
    const html = buildOrderPdfHtml(draft, [line()], null);
    expect(html).toContain("Cabo &lt;flexível&gt; 2,5mm");
    expect(html).not.toContain("<flexível>");
    expect(html).toContain("1,2345");
    expect(html).not.toContain("Force nº");
    expect(html).toContain("Entregar cedo");
  });
});

describe("unavailable customer (no seal on the document)", () => {
  const held = draftRecord({ status: "sync_error", lastError: CUSTOMER_UNAVAILABLE_MESSAGE, remoteDraftNumber: 7 });
  const legacyHeld = draftRecord({ status: "sync_error", lastError: LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE, remoteDraftNumber: 7 });

  it.each([held, legacyHeld])("orderDocumentOf throws the typed error instead of building a document", (draft) => {
    expect(() => orderDocumentOf(draft, [line()])).toThrow(OrderPdfCustomerUnavailableError);
    expect(() => buildOrderPdfHtml(draft, [line()], null)).toThrow(OrderPdfCustomerUnavailableError);
  });

  it("the typed error is an Error with a stable name", () => {
    const error = new OrderPdfCustomerUnavailableError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OrderPdfCustomerUnavailableError");
  });

  it.each([held, legacyHeld])("shareOrderPdf returns customer_unavailable and never calls sharePdf", async (draft) => {
    const sharePdf = jest.fn(async () => undefined);
    await expect(shareOrderPdf({ sharePdf }, draft, [line()])).resolves.toEqual({ ok: false, reason: "customer_unavailable" });
    expect(sharePdf).not.toHaveBeenCalled();
  });

  it("an order without items is still 'empty' (checked first)", async () => {
    const sharePdf = jest.fn(async () => undefined);
    await expect(shareOrderPdf({ sharePdf }, held, [])).resolves.toEqual({ ok: false, reason: "empty" });
  });

  it("a different held cause (a customer cause stored by the server) is also refused", async () => {
    const blocked = draftRecord({ status: "sync_error", lastError: CUSTOMER_BLOCK_MESSAGES.customer_blocked });
    expect(() => orderDocumentOf(blocked, [line()])).toThrow(OrderPdfCustomerUnavailableError);
  });
});

describe("pdfStatusLabelOf", () => {
  const draftStates: DraftRecord["status"][] = ["local_only", "pending_sync", "syncing", "synced", "sync_error", "conflict", "needs_review"];
  const heldErrors = [...Object.values(PRODUCT_BLOCK_MESSAGES), CUSTOMER_UNAVAILABLE_MESSAGE, LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE, ...Object.values(CUSTOMER_BLOCK_MESSAGES), null, "Erro qualquer"];

  it("never says Rascunho and never carries the held seal, for every state and held cause", () => {
    for (const status of draftStates) {
      for (const lastError of heldErrors) {
        const label = pdfStatusLabelOf({ status, remoteId: status === "synced" ? "r1" : null, lastError });
        expect(label).not.toMatch(/rascunho/i);
        const held = status === "sync_error" && lastError !== null && lastError !== "Erro qualquer";
        if (held) expect(label).not.toMatch(/indispon[ií]vel/i);
      }
    }
  });

  it("a product-blocked order prints the plain local state, not the seal", () => {
    expect(pdfStatusLabelOf({ status: "sync_error", remoteId: null, lastError: PRODUCT_BLOCK_MESSAGES.product_without_price })).toBe("Erro");
  });

  it("normal states keep their seller wording", () => {
    expect(pdfStatusLabelOf({ status: "local_only", remoteId: null, lastError: null })).toBe("Salvo no aparelho");
    expect(pdfStatusLabelOf({ status: "synced", remoteId: "r1", lastError: null })).toBe("Salvo no aparelho");
  });

  it("the document of a product-blocked order is built with that plain label", () => {
    const draft = draftRecord({ status: "sync_error", lastError: PRODUCT_BLOCK_MESSAGES.product_inactive, remoteDraftNumber: 3 });
    expect(orderDocumentOf(draft, [line()]).statusLabel).toBe("Erro");
  });
});

describe("shareOrderPdf", () => {
  it("hands the HTML to the port and reports success; works from local data only", async () => {
    const calls: string[] = [];
    const port: OrderPdfPort = { sharePdf: async (html, name) => void calls.push(`${name}:${html.length > 100}`) };
    await expect(shareOrderPdf(port, draftRecord({ remoteDraftNumber: 7 }), [line()])).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["pedido:true"]);
  });

  it("refuses an order without items and turns a port failure into a result, not a crash", async () => {
    const port: OrderPdfPort = { sharePdf: async () => { throw new Error("no share"); } };
    await expect(shareOrderPdf(port, draftRecord(), [])).resolves.toEqual({ ok: false, reason: "empty" });
    await expect(shareOrderPdf(port, draftRecord(), [line()])).resolves.toEqual({ ok: false, reason: "failed" });
  });
});
