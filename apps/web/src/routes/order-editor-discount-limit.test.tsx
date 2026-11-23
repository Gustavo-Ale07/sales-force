import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { exceedsLimit, formatLimit } from "../lib/discount-limit";
import { customer, customerDetail, customersPage, orderDetail, pricedList, product, productsPage } from "../test/fixtures";
import { callsTo, fillOrderHeader, renderApp, type Handlers } from "../test/harness";

vi.setConfig({ testTimeout: 20_000 });

const QUESTION = "Esse desconto é acima do liberado. Tem certeza que deseja utilizar essa %?";

const catalog = productsPage([
  product({ code: 4158, description: "Item A", listPrice: pricedList("10"), maxDiscountPercent: "12" }),
  product({ code: 4159, description: "Item B", listPrice: pricedList("20"), maxDiscountPercent: "12" }),
  product({ code: 1439, description: "Item C", listPrice: pricedList("5"), maxDiscountPercent: "12" }),
  product({ code: 5000, description: "Item sem limite", listPrice: pricedList("5"), maxDiscountPercent: null }),
]);

const handlers = (extra: Handlers = {}): Handlers => ({
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  "GET /products": { body: catalog },
  ...extra,
});

type User = ReturnType<typeof renderApp>["user"];

async function addProduct(user: User, description: string) {
  await fillOrderHeader(user);
  const produtos = await screen.findByRole("button", { name: "Produtos" });
  if (produtos.getAttribute("aria-pressed") !== "true") await user.click(produtos);
  const add = await screen.findByRole("button", { name: new RegExp(`^Adicionar .*${description}`) });
  await waitFor(() => expect(add).toBeEnabled());
  await user.click(add);
}

const showCart = (user: User) => user.click(screen.getByRole("button", { name: /^Carrinho/ }));
const field = (name: string) => screen.getByLabelText(`Desconto de ${name} (%)`);
const noDialog = () => expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

async function cartWith(user: User, names: string[]) {
  for (const name of names) await addProduct(user, name);
  await showCart(user);
}

/** Types a discount and leaves the field, which is when the limit is checked. */
async function typeDiscount(user: User, name: string, text: string) {
  await user.clear(field(name));
  await user.type(field(name), text);
  await user.tab();
}

describe("limit helpers", () => {
  it("compares exactly and treats a missing limit as no limit", () => {
    expect(exceedsLimit("15", "12")).toBe(true);
    expect(exceedsLimit("12", "12")).toBe(false);
    expect(exceedsLimit("12,01", "12")).toBe(true);
    expect(exceedsLimit("99", null)).toBe(false);
    expect(exceedsLimit("99", undefined)).toBe(false);
    expect(formatLimit("12.5000")).toBe("12,5");
    expect(formatLimit("12")).toBe("12");
  });
});

describe("Desconto acima do limite do produto: por item", () => {
  it("shows the limit and asks once when the typed discount is above it; Sim keeps it and flags the field", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item A"]);
    expect(screen.getByTestId("discount-limit-4158")).toHaveTextContent("Máx. 12%");
    await typeDiscount(user, "Item A", "15");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(QUESTION);
    await user.click(within(dialog).getByRole("button", { name: "Sim" }));
    await waitFor(noDialog);
    expect(field("Item A")).toHaveValue("15");
    expect(screen.getByTestId("discount-limit-4158").className).toMatch(/text-warn/);
  });

  it("restores the previous value on Não", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item A"]);
    await typeDiscount(user, "Item A", "10");
    noDialog();
    await typeDiscount(user, "Item A", "15");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Não" }));
    await waitFor(noDialog);
    expect(field("Item A")).toHaveValue("10");
    expect(screen.getByTestId("discount-limit-4158").className).not.toMatch(/text-warn/);
  });

  it("does not ask for a discount within the limit", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item A"]);
    await typeDiscount(user, "Item A", "12");
    noDialog();
  });

  it("does not ask again for the order after the first Sim (other item, same item)", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item A", "Item B"]);
    await typeDiscount(user, "Item A", "15");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sim" }));
    await waitFor(noDialog);
    await typeDiscount(user, "Item B", "15");
    noDialog();
    await typeDiscount(user, "Item A", "20");
    noDialog();
    expect(field("Item B")).toHaveValue("15");
  });

  it("never warns for a product without a registered limit and shows no limit hint", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item sem limite"]);
    await typeDiscount(user, "Item sem limite", "50");
    noDialog();
    expect(screen.queryByTestId("discount-limit-5000")).not.toBeInTheDocument();
  });

  it("does not block saving or sending the order", async () => {
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: handlers({ "POST /orders": { status: 201, body: orderDetail() }, "GET /orders/:id": { body: orderDetail() } }),
    });
    await cartWith(user, ["Item A"]);
    await typeDiscount(user, "Item A", "15");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sim" }));
    await waitFor(noDialog);
    const confirm = screen.getByRole("button", { name: "Confirmar pedido" });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(callsTo(calls, "POST", "/orders")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/orders")[0]?.body).toMatchObject({ items: [{ productCode: 4158, discountPercent: "15" }] });
  });
});

describe("Desconto acima do limite do produto: pedido todo", () => {
  async function openMass(user: User) {
    await user.click(screen.getByRole("button", { name: "Desconto no pedido todo" }));
    const dialog = await screen.findByRole("dialog", { name: "Desconto no pedido todo" });
    await user.type(within(dialog).getByLabelText("Desconto no pedido todo (%)"), "15");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar desconto" }));
  }

  it("asks once with the list of items; Sim applies the typed percentage to all", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item A", "Item B", "Item sem limite"]);
    await openMass(user);
    const dialog = await screen.findByRole("dialog", { name: "Desconto acima do liberado" });
    expect(dialog).toHaveTextContent(QUESTION);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const list = within(dialog).getByTestId("discount-limit-list");
    expect(list).toHaveTextContent("1 item dentro do limite");
    expect(list).toHaveTextContent("2 itens acima");
    expect(list).toHaveTextContent("Item A");
    expect(list).toHaveTextContent("limite 12% · digitado 15%");
    await user.click(within(dialog).getByRole("button", { name: "Sim" }));
    await waitFor(noDialog);
    expect(field("Item A")).toHaveValue("15");
    expect(field("Item B")).toHaveValue("15");
    expect(field("Item sem limite")).toHaveValue("15");
  });

  it("cancels the whole operation on Não", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item A", "Item sem limite"]);
    await openMass(user);
    const dialog = await screen.findByRole("dialog", { name: "Desconto acima do liberado" });
    await user.click(within(dialog).getByRole("button", { name: "Não" }));
    await waitFor(noDialog);
    expect(field("Item A")).toHaveValue("");
    expect(field("Item sem limite")).toHaveValue("");
  });

  it("does not ask after a Sim already given on an item", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item A", "Item B"]);
    await typeDiscount(user, "Item A", "15");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sim" }));
    await waitFor(noDialog);
    await openMass(user);
    await waitFor(() => expect(field("Item B")).toHaveValue("15"));
    noDialog();
  });

  it("does not ask when no item exceeds its limit", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await cartWith(user, ["Item sem limite"]);
    await openMass(user);
    await waitFor(() => expect(field("Item sem limite")).toHaveValue("15"));
    noDialog();
  });
});
