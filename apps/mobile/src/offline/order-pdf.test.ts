import { draftRecord } from "../test-doubles";
import type { EditorLine } from "../data/order-draft";
import { buildOrderPdfHtml, orderDocumentOf, shareOrderPdf, type OrderPdfPort } from "./order-pdf";

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
    expect(model.draftNumber).toBe(42);
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
    expect(html).toContain("Pedido Force nº 42");
    expect(html).toContain("Entregar cedo");
  });
});

describe("shareOrderPdf", () => {
  it("hands the HTML to the port and reports success; works from local data only", async () => {
    const calls: string[] = [];
    const port: OrderPdfPort = { sharePdf: async (html, name) => void calls.push(`${name}:${html.length > 100}`) };
    await expect(shareOrderPdf(port, draftRecord({ remoteDraftNumber: 7 }), [line()])).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["pedido-7:true"]);
  });

  it("refuses an order without items and turns a port failure into a result, not a crash", async () => {
    const port: OrderPdfPort = { sharePdf: async () => { throw new Error("no share"); } };
    await expect(shareOrderPdf(port, draftRecord(), [])).resolves.toEqual({ ok: false, reason: "empty" });
    await expect(shareOrderPdf(port, draftRecord(), [line()])).resolves.toEqual({ ok: false, reason: "failed" });
  });
});
