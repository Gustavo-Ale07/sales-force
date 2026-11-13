import { beforeEach, describe, expect, it } from "vitest";
import {
  countOutbox,
  listAttentionItems,
  listOutbox,
  migrations,
  pushOutbox,
  reevaluateHeldOrders,
  replaceCustomers,
  replacePriceTables,
  replaceProducts,
  runMigrations,
  saveOrderDraft,
  PRODUCT_BLOCK_MESSAGES,
  TransportError,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderTransport,
  type RemoteOrder,
  type SaveDraftInput,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
const priced = (table: number, price: string) => ({ state: "priced", unitPrice: price, tableCode: table, versionId: 1 });
const product = (code: number) => ({ code, description: `Produto ${code}`, listPrice: priced(5, "9.00") });

function makeEnv(): OfflineEnv {
  let n = 0;
  return { now: () => new Date("2026-11-13T12:00:00.000Z"), newId: () => `id-${String(++n).padStart(4, "0")}` };
}

function input(productCode: number): SaveDraftInput {
  return {
    ownerAccountId: OWNER,
    customerCode: 10,
    customerName: "Cliente 10",
    negotiationTypeCode: null,
    topCode: null,
    carrierCode: null,
    notes: null,
    loadedDataset: REAL,
    items: [{ productCode, description: `Produto ${productCode}`, unit: "UN", quantity: "2", discountPercent: "0", priceJson: JSON.stringify(priced(3, "8.00")), groupCode: 1, groupName: "G" }],
  };
}

class Server implements OrderTransport {
  requests: string[] = [];
  async createOrder(key: string, request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    this.requests.push(`POST ${key}`);
    return {
      id: "order-1",
      version: 1,
      draftNumber: 1,
      customerCode: request.customerCode,
      customerName: "Cliente",
      negotiationTypeCode: null,
      topCode: null,
      carrierCode: null,
      notes: null,
      estimatedTotal: "16.00",
      items: request.items.map((line) => ({ productCode: line.productCode, productDescription: "P", unit: "UN", quantity: line.quantity, unitListPrice: "8.00", priceState: "priced" as const, priceTableCode: 3, priceVersionId: 1, discountPercent: "0" })),
    };
  }
  async replaceOrder(): Promise<RemoteOrder> {
    throw new TransportError("server", "x");
  }
  async getOrder(): Promise<RemoteOrder> {
    throw new TransportError("not_found", "x", 404);
  }
}

let db: SqlDatabase;
let env: OfflineEnv;
let server: Server;
const push = () => pushOutbox(db, env, server, OWNER, { respectBackoff: false, currentDataset: REAL });
const catalog = (codes: number[], table3: number[]) =>
  db.transaction(async (tx) => {
    await replaceCustomers(tx, [{ code: 10, name: "Cliente 10", active: true, blocked: false, sellerCode: 1, priceTableCode: 3 } as never]);
    await replaceProducts(tx, codes.map(product));
    await replacePriceTables(tx, [{ tableCode: 3, prices: table3.map((code) => ({ productCode: code, listPrice: priced(3, "8.00") })) }]);
  });
const lastErrors = async () => (await listOutbox(db)).map((op) => op.lastError);

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  env = makeEnv();
  server = new Server();
});

describe("product guard (local, indicative; the server revalidates)", () => {
  it("a product that is still sellable is sent", async () => {
    await catalog([1, 2], [1, 2]);
    await saveOrderDraft(db, env, input(1));
    await push();
    expect(server.requests).toHaveLength(1);
  });

  it("a product that left the catalog (mobility) holds the order: not sent, marked, counted as attention, listed", async () => {
    await catalog([2], [2]);
    await saveOrderDraft(db, env, input(1));
    const result = await push();
    expect(server.requests).toEqual([]);
    expect(result.attempted).toBe(0);
    expect(await lastErrors()).toEqual([PRODUCT_BLOCK_MESSAGES.product_without_mobility]);
    expect(PRODUCT_BLOCK_MESSAGES).toEqual({
      product_without_mobility: "Produto sem mobilidade",
      product_without_price: "Produto sem preço",
      product_unavailable: "Produto indisponível",
      product_inactive: "Produto inativo",
    });
    expect(await countOutbox(db, OWNER, REAL)).toMatchObject({ pending: 0, needsAttention: 1 });
    expect((await listAttentionItems(db, OWNER))[0]?.reason).toBe("Produto sem mobilidade");
  });

  it("a product with no price above zero in the customer's table holds the order as 'Produto sem preço'", async () => {
    await catalog([1, 2], [2]);
    await saveOrderDraft(db, env, input(1));
    await push();
    expect(server.requests).toEqual([]);
    expect(await lastErrors()).toEqual(["Produto sem preço"]);
  });

  it("is released after a later pull that brings the product back, and then goes out", async () => {
    await catalog([2], [2]);
    await saveOrderDraft(db, env, input(1));
    await push();
    await catalog([1, 2], [1, 2]);
    expect(await reevaluateHeldOrders(db, env, OWNER)).toBe(1);
    expect(await lastErrors()).toEqual([null]);
    await push();
    expect(server.requests).toHaveLength(1);
  });

  it("changes the mark when the cause changes (mobility lost, then back but without price)", async () => {
    await catalog([2], [2]);
    await saveOrderDraft(db, env, input(1));
    await push();
    await catalog([1, 2], [2]);
    await reevaluateHeldOrders(db, env, OWNER);
    expect(await lastErrors()).toEqual(["Produto sem preço"]);
  });

  it("an empty catalog (never downloaded) is not 'sem mobilidade': the guard does not guess", async () => {
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 10, name: "Cliente 10", active: true, blocked: false, sellerCode: 1, priceTableCode: 3 } as never]));
    await saveOrderDraft(db, env, input(1));
    await push();
    expect(server.requests).toHaveLength(1);
  });

  it("a customer whose table was not downloaded falls back to the base price of the catalog", async () => {
    await db.transaction(async (tx) => {
      await replaceCustomers(tx, [{ code: 10, name: "Cliente 10", active: true, blocked: false, sellerCode: 1, priceTableCode: 3 } as never]);
      await replaceProducts(tx, [product(1), { code: 2, description: "Produto 2", listPrice: { state: "none" } }]);
    });
    await saveOrderDraft(db, env, input(1));
    await saveOrderDraft(db, env, input(2));
    await push();
    expect(server.requests).toHaveLength(1);
    expect((await lastErrors()).filter((e) => e !== null)).toEqual(["Produto sem preço"]);
  });
});
