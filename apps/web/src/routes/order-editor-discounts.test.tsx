import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ORDER_ID,
  customer,
  customerDetail,
  customersPage,
  noPriceList,
  orderDetail,
  orderItem,
  pricedList,
  product,
  productsPage,
} from "../test/fixtures";
import { callsTo, renderApp, type Handlers } from "../test/harness";

// Full-screen renders with typing: give them room when turbo runs every package suite in parallel.
vi.setConfig({ testTimeout: 20_000 });

const catalog = productsPage([
  product({ code: 2001, description: "Balão látex vermelho", groupCode: 30, groupName: "Balões", listPrice: pricedList("10") }),
  product({ code: 2002, description: "Balão látex azul", groupCode: 30, groupName: "Balões", listPrice: pricedList("20") }),
  product({ code: 2003, description: "Vela aniversário", groupCode: 40, groupName: "Velas", listPrice: pricedList("5") }),
  product({ code: 2004, description: "Vela sem preço", groupCode: 40, groupName: "Velas", listPrice: noPriceList("no_price_row") }),
]);

const handlers = (extra: Handlers = {}): Handlers => ({
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  "GET /products": { body: catalog },
  ...extra,
});

type User = ReturnType<typeof renderApp>["user"];

async function addProduct(user: User, description: string) {
  const produtos = await screen.findByRole("button", { name: "Produtos" });
  if (produtos.getAttribute("aria-pressed") !== "true") await user.click(produtos);
  const add = await screen.findByRole("button", { name: new RegExp(`^Adicionar .*${description}`) });
  await waitFor(() => expect(add).toBeEnabled());
  await user.click(add);
}

const showCart = (user: User) => user.click(screen.getByRole("button", { name: /^Carrinho/ }));

/** Cart with 2 balloons (10 and 20), 1 candle (5) and a candle without a price, quantity 1 each. */
async function fillCart(user: User) {
  for (const name of ["Balão látex vermelho", "Balão látex azul", "Vela aniversário", "Vela sem preço"]) await addProduct(user, name);
  await showCart(user);
}

const discountField = (name: string) => screen.getByLabelText(`Desconto de ${name} (%)`);

describe("Desconto por item", () => {
  it("takes the percentage off the line and shows the subtotal, the discounts and the total", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await addProduct(user, "Balão látex vermelho");
    await showCart(user);
    await user.type(discountField("Balão látex vermelho"), "12,5");
    const row = screen.getByText("Balão látex vermelho").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("8,75");
    expect(screen.getByTestId("order-list-total")).toHaveTextContent("10,00");
    expect(screen.getByTestId("order-discount-total")).toHaveTextContent("1,25");
    expect(screen.getByTestId("order-total")).toHaveTextContent("8,75");
  });

  it("can be set when the product is added from the Produtos tab", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    const field = await screen.findByLabelText("Desconto de Balão látex vermelho (%) a adicionar");
    await user.type(field, "10");
    await user.click(await screen.findByRole("button", { name: /^Adicionar .*Balão látex vermelho/ }));
    await showCart(user);
    expect(discountField("Balão látex vermelho")).toHaveValue("10");
    expect(screen.getByTestId("order-total")).toHaveTextContent("9,00");
  });

  it("rejects an invalid discount at add time and does not add the product", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await user.type(await screen.findByLabelText("Desconto de Balão látex vermelho (%) a adicionar"), "100");
    await user.click(await screen.findByRole("button", { name: /^Adicionar .*Balão látex vermelho/ }));
    expect(await screen.findByText("O desconto deve ser menor que 100%.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Carrinho \(0\)/ })).toBeInTheDocument();
  });

  it("flags an invalid discount, keeps the line out of the sum and blocks saving", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await addProduct(user, "Balão látex vermelho");
    await showCart(user);
    await user.type(discountField("Balão látex vermelho"), "12.5");
    expect(await screen.findByText("Use vírgula como separador decimal.")).toBeInTheDocument();
    expect(screen.getByText("1 item com quantidade ou desconto inválido não entra na soma.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("is disabled for a line without a price", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await addProduct(user, "Vela sem preço");
    await showCart(user);
    expect(discountField("Vela sem preço")).toBeDisabled();
  });

  it("sends the percentage in the request and never a price or a total", async () => {
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: handlers({ "POST /orders": { status: 201, body: orderDetail() }, "GET /orders/:id": { body: orderDetail() } }),
    });
    await addProduct(user, "Balão látex vermelho");
    await addProduct(user, "Vela aniversário");
    await showCart(user);
    await user.type(discountField("Balão látex vermelho"), "10");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/orders")).toHaveLength(1));
    const [created] = callsTo(calls, "POST", "/orders");
    expect(created?.body).toMatchObject({
      items: [
        { productCode: 2001, quantity: "1", discountPercent: "10" },
        { productCode: 2003, quantity: "1" },
      ],
    });
    expect(JSON.stringify(created?.body)).not.toMatch(/price|preco|total/i);
  });

  it("counts a changed discount as an unsaved change", async () => {
    const saved = orderDetail({ items: [orderItem({ quantity: "2", discountPercent: "5" })] });
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: handlers({ "GET /orders/:id": { body: saved } }),
    });
    const field = await screen.findByLabelText("Desconto de Balão látex 9 pol. vermelho (%)");
    expect(field).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
    await user.clear(field);
    await user.type(field, "7");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled();
  });
});

describe("Desconto em massa", () => {
  it("applies the same percentage to every priced item, skipping the one without price", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await fillCart(user);
    await user.click(screen.getByRole("button", { name: "Desconto em massa" }));
    const dialog = await screen.findByRole("dialog", { name: "Desconto em massa" });
    expect(dialog).toHaveTextContent("3 itens recebem o desconto.");
    expect(dialog).toHaveTextContent("1 item sem preço fica de fora.");
    await user.type(within(dialog).getByLabelText("Desconto em massa (%)"), "10");
    expect(dialog).toHaveTextContent("31,50");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar desconto" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Desconto em massa" })).not.toBeInTheDocument());
    expect(discountField("Balão látex vermelho")).toHaveValue("10");
    expect(discountField("Balão látex azul")).toHaveValue("10");
    expect(discountField("Vela aniversário")).toHaveValue("10");
    expect(discountField("Vela sem preço")).toBeDisabled();
    expect(screen.getByTestId("order-list-total")).toHaveTextContent("35,00");
    expect(screen.getByTestId("order-discount-total")).toHaveTextContent("3,50");
    expect(screen.getByTestId("order-total")).toHaveTextContent("31,50");
  });

  it("replaces discounts typed before and can remove them all", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await fillCart(user);
    await user.type(discountField("Balão látex azul"), "50");
    await user.click(screen.getByRole("button", { name: "Desconto em massa" }));
    let dialog = await screen.findByRole("dialog", { name: "Desconto em massa" });
    await user.type(within(dialog).getByLabelText("Desconto em massa (%)"), "20{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Desconto em massa" })).not.toBeInTheDocument());
    expect(discountField("Balão látex azul")).toHaveValue("20");

    await user.click(screen.getByRole("button", { name: "Desconto em massa" }));
    dialog = await screen.findByRole("dialog", { name: "Desconto em massa" });
    await user.click(within(dialog).getByRole("button", { name: "Remover descontos" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Desconto em massa" })).not.toBeInTheDocument());
    expect(discountField("Balão látex azul")).toHaveValue("");
    expect(screen.queryByTestId("order-discount-total")).not.toBeInTheDocument();
  });

  it("does not apply an invalid percentage", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await fillCart(user);
    await user.click(screen.getByRole("button", { name: "Desconto em massa" }));
    const dialog = await screen.findByRole("dialog", { name: "Desconto em massa" });
    await user.type(within(dialog).getByLabelText("Desconto em massa (%)"), "150");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar desconto" }));
    expect(await within(dialog).findByText("O desconto deve ser menor que 100%.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Desconto em massa" })).toBeInTheDocument();
    expect(discountField("Balão látex vermelho")).toHaveValue("");
  });

  it("is unavailable while the cart is empty", async () => {
    renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    expect(await screen.findByRole("button", { name: "Desconto em massa" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Desconto por grupo" })).toBeDisabled();
  });
});

describe("Desconto por grupo", () => {
  it("applies a percentage per group, leaving the empty groups and the item without price alone", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await fillCart(user);
    await user.click(screen.getByRole("button", { name: "Desconto por grupo" }));
    const dialog = await screen.findByRole("dialog", { name: "Desconto por grupo" });
    expect(await within(dialog).findByText("Balões")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("2 itens no carrinho");
    expect(within(dialog).getByRole("button", { name: "Aplicar descontos" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Desconto do grupo Balões (%)"), "10");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar descontos" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Desconto por grupo" })).not.toBeInTheDocument());
    expect(discountField("Balão látex vermelho")).toHaveValue("10");
    expect(discountField("Balão látex azul")).toHaveValue("10");
    expect(discountField("Vela aniversário")).toHaveValue("");
    expect(discountField("Vela sem preço")).toBeDisabled();
    // 10 + 20 = 30, 10% off = 27; plus the candle 5.
    expect(screen.getByTestId("order-total")).toHaveTextContent("32,00");
    expect(screen.getByTestId("order-discount-total")).toHaveTextContent("3,00");
  });

  it("applies different percentages to several groups at once", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await fillCart(user);
    await user.click(screen.getByRole("button", { name: "Desconto por grupo" }));
    const dialog = await screen.findByRole("dialog", { name: "Desconto por grupo" });
    await user.type(await within(dialog).findByLabelText("Desconto do grupo Balões (%)"), "10");
    await user.type(within(dialog).getByLabelText("Desconto do grupo Velas (%)"), "20,5");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar descontos" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Desconto por grupo" })).not.toBeInTheDocument());
    expect(discountField("Balão látex azul")).toHaveValue("10");
    expect(discountField("Vela aniversário")).toHaveValue("20,5");
  });

  it("keeps Aplicar disabled and shows the problem for an invalid percentage", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
    await fillCart(user);
    await user.click(screen.getByRole("button", { name: "Desconto por grupo" }));
    const dialog = await screen.findByRole("dialog", { name: "Desconto por grupo" });
    await user.type(await within(dialog).findByLabelText("Desconto do grupo Balões (%)"), "abc");
    expect(within(dialog).getByText("Desconto inválido.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Aplicar descontos" })).toBeDisabled();
  });

  it("finds the group of the items of a saved draft through the catalog", async () => {
    const saved = orderDetail({
      items: [orderItem({ productCode: 2001, productDescription: "Balão látex vermelho", quantity: "1", unitListPrice: "10" })],
    });
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: handlers({
        "GET /orders/:id": { body: saved },
        "GET /products/:code": { body: { ...product({ code: 2001, groupCode: 30, groupName: "Balões" }), usageCode: null, priceContext: catalog.priceContext } },
      }),
    });
    await screen.findByLabelText("Desconto de Balão látex vermelho (%)");
    await user.click(screen.getByRole("button", { name: "Desconto por grupo" }));
    const dialog = await screen.findByRole("dialog", { name: "Desconto por grupo" });
    await user.type(await within(dialog).findByLabelText("Desconto do grupo Balões (%)"), "10");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar descontos" }));
    await waitFor(() => expect(screen.getByLabelText("Desconto de Balão látex vermelho (%)")).toHaveValue("10"));
  });
});
