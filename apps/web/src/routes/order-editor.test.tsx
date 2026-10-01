import type { ApiSchema } from "@salesforce/contracts/client";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ORDER_ID,
  customer,
  customerDetail,
  customersPage,
  ordersPage,
  orderEntryConfiguration,
  orderListItem,
  noPriceList,
  orderDetail,
  orderItem,
  pricedList,
  testDataset,
  product,
  productsPage,
} from "../test/fixtures";
import { apiError, callsTo, renderApp, type Handlers } from "../test/harness";
import { SUBMIT_DISABLED_MESSAGE } from "./order-editor";

const FORBIDDEN_TERMS = /custo|margem|cost|margin/i;

const catalog = productsPage([
  product({ code: 2001, description: "Balão látex 9 pol. vermelho", listPrice: pricedList("12.5") }),
  product({ code: 2002, description: "Vela sem preço", listPrice: noPriceList("no_price_row") }),
]);

const newOrderHandlers = (extra: Handlers = {}): Handlers => ({
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  "GET /products": { body: catalog },
  ...extra,
});

/** Adds a product from the "Produtos" table, then shows the cart (where the lines are edited). */
async function addProduct(user: ReturnType<typeof renderApp>["user"], description: string) {
  const produtos = await screen.findByRole("button", { name: "Produtos" });
  if (produtos.getAttribute("aria-pressed") !== "true") await user.click(produtos);
  const add = await screen.findByRole("button", { name: new RegExp(`^Adicionar .*${description}`) });
  await waitFor(() => expect(add).toBeEnabled());
  await user.click(add);
  await user.click(screen.getByRole("button", { name: /^Carrinho/ }));
}

const withOrderEntryConfiguration = (
  patch: (config: ApiSchema<"OrderEntryConfiguration">) => ApiSchema<"OrderEntryConfiguration">,
): Handlers => ({
  "GET /order-entry/configuration": { body: patch(orderEntryConfiguration) },
});

describe("Novo pedido", () => {
  it("cannot pick products before a customer is chosen", async () => {
    renderApp("/pedidos/novo", { handlers: newOrderHandlers() });
    expect(await screen.findByRole("heading", { name: /^Novo pedido/ })).toBeInTheDocument();
    expect(screen.getByText("Selecione o cliente")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Buscar produto" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lançamento múltiplo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("computes the totals with the domain, showing 'Sem preço' and a partial total", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
    await addProduct(user, "Balão");
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "2,5");
    expect(screen.getByTestId("order-total")).toHaveTextContent("31,25");

    await addProduct(user, "Vela");
    const row = screen.getByText("Vela sem preço").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Sem preço");
    expect(row).not.toHaveTextContent(/0,00/);
    expect(screen.getByText("Total parcial estimado")).toBeInTheDocument();
    expect(screen.getByText("1 item sem preço não entra na soma.")).toBeInTheDocument();
    expect(screen.getByTestId("order-total")).toHaveTextContent("31,25");
  });

  describe("changing the customer once items exist", () => {
    const handlers = () =>
      newOrderHandlers({ "GET /customers": { body: customersPage([customer(), customer({ code: 1002, name: "Beta Ltda" })]) } });
    const pickOther = async (user: ReturnType<typeof renderApp>["user"]) => {
      await user.click(await screen.findByRole("button", { name: /^Cliente/ }));
      await user.click(await screen.findByRole("button", { name: /Beta Ltda/ }));
    };

    it("asks first and drops the items (their prices belong to the previous customer) only when confirmed", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
      await addProduct(user, "Balão");
      await pickOther(user);
      const dialog = await screen.findByRole("dialog", { name: "Trocar o cliente do pedido?" });
      expect(dialog).toHaveTextContent("itens já adicionados serão removidos");
      await user.click(within(dialog).getByRole("button", { name: "Trocar e remover itens" }));
      await waitFor(() => expect(screen.queryByLabelText("Quantidade de Balão látex 9 pol. vermelho")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: /^Cliente/ })).toHaveTextContent(/Beta Ltda/);
    });

    it("keeps the customer and the items when the seller declines", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
      await addProduct(user, "Balão");
      await pickOther(user);
      const dialog = await screen.findByRole("dialog", { name: "Trocar o cliente do pedido?" });
      await user.click(within(dialog).getByRole("button", { name: "Manter o cliente atual" }));
      expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Cliente/ })).toHaveTextContent(/Comercial Alfa/);
    });

    it("asks as well when the customer is cleared, so picking another one afterwards cannot keep the old prices", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
      await addProduct(user, "Balão");
      await user.click(screen.getByRole("button", { name: "Remover cliente" }));
      const dialog = await screen.findByRole("dialog", { name: "Trocar o cliente do pedido?" });
      expect(dialog).toHaveTextContent("Ao remover o cliente");
      await user.click(within(dialog).getByRole("button", { name: "Manter o cliente atual" }));
      expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toBeInTheDocument();
    });

    it("drops the items when clearing the customer is confirmed, and picking another one then asks nothing", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
      await addProduct(user, "Balão");
      await user.click(screen.getByRole("button", { name: "Remover cliente" }));
      await user.click(
        within(await screen.findByRole("dialog", { name: "Trocar o cliente do pedido?" })).getByRole("button", {
          name: "Trocar e remover itens",
        }),
      );
      await waitFor(() => expect(screen.queryByLabelText("Quantidade de Balão látex 9 pol. vermelho")).not.toBeInTheDocument());
      await pickOther(user);
      expect(screen.queryByRole("dialog", { name: "Trocar o cliente do pedido?" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Quantidade de Balão látex 9 pol. vermelho")).not.toBeInTheDocument();
    });

    it("does not bring back removed lines (priced for the previous customer) with Desfazer after the change", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: handlers() });
      await addProduct(user, "Balão");
      await addProduct(user, "Vela");
      await user.click(await screen.findByRole("checkbox", { name: "Selecionar Balão látex 9 pol. vermelho" }));
      await user.click(screen.getByRole("button", { name: "Remover selecionados" }));
      await pickOther(user);
      const dialog = await screen.findByRole("dialog", { name: "Trocar o cliente do pedido?" });
      await user.click(within(dialog).getByRole("button", { name: "Trocar e remover itens" }));
      await waitFor(() => expect(screen.queryByLabelText("Quantidade de Vela sem preço")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Desfazer" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Quantidade de Balão látex 9 pol. vermelho")).not.toBeInTheDocument();
    });
  });

  describe("customer selector modal", () => {
    const twoCustomers = () =>
      newOrderHandlers({
        "GET /customers": { body: customersPage([customer(), customer({ code: 1002, name: "Beta Ltda", blocked: true, document: "12345678901" })]) },
      });

    it("opens a dedicated dialog with a search box and one card per customer (no dropdown)", async () => {
      const { user } = renderApp("/pedidos/novo", { handlers: twoCustomers() });
      expect(screen.queryByRole("combobox", { name: /^Cliente/ })).not.toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: /^Cliente/ }));
      const dialog = await screen.findByRole("dialog", { name: "Selecionar cliente" });
      await waitFor(() => expect(within(dialog).getByRole("searchbox", { name: "Cliente" })).toHaveFocus());
      const alfa = await within(dialog).findByRole("button", { name: /Comercial Alfa Ltda/ });
      expect(alfa).toHaveTextContent("1001 – Comercial Alfa Ltda");
      expect(alfa).toHaveTextContent("11.222.333/0001-81");
      expect(alfa).toHaveTextContent("Alfa Festas");
      const beta = within(dialog).getByRole("button", { name: /Beta Ltda/ });
      expect(beta).toHaveTextContent("123.456.789-01");
      expect(beta).toHaveTextContent("Bloqueado");
    });

    it("sends the typed search to the server and shows an empty state", async () => {
      const { user, calls } = renderApp("/pedidos/novo", {
        handlers: newOrderHandlers({ "GET /customers": { body: customersPage([]) } }),
      });
      await user.click(await screen.findByRole("button", { name: /^Cliente/ }));
      const dialog = await screen.findByRole("dialog", { name: "Selecionar cliente" });
      await user.type(within(dialog).getByRole("searchbox", { name: "Cliente" }), "zzz");
      await waitFor(() => expect(callsTo(calls, "GET", "/customers").some((call) => call.search.get("search") === "zzz")).toBe(true));
      expect(await within(dialog).findByText("Nenhum cliente encontrado")).toBeInTheDocument();
    });

    it("closes the dialog and shows the picked customer on the field", async () => {
      const { user } = renderApp("/pedidos/novo", { handlers: twoCustomers() });
      await user.click(await screen.findByRole("button", { name: /^Cliente/ }));
      await user.click(await screen.findByRole("button", { name: /Beta Ltda/ }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Selecionar cliente" })).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: /^Cliente/ })).toHaveTextContent("1002 — Beta Ltda");
    });
  });

  describe("customer ficha modal", () => {
    const fichaHandlers = () =>
      newOrderHandlers({
        "GET /customers/:code": { body: customerDetail({ creditLimit: "5000" }) },
        "GET /orders": { body: ordersPage([orderListItem()]) },
      });

    it("only offers the ficha once a customer is selected", async () => {
      renderApp("/pedidos/novo", { handlers: fichaHandlers() });
      await screen.findByRole("button", { name: /^Cliente/ });
      expect(screen.queryByRole("button", { name: "Ficha do cliente" })).not.toBeInTheDocument();
    });

    it("pins a customer context bar with document, price table, credit limit and status", async () => {
      renderApp("/pedidos/novo?customer=1001", { handlers: fichaHandlers() });
      const bar = await screen.findByRole("region", { name: "Cliente do pedido" });
      expect(bar).toHaveTextContent("Cliente: 1001 – Comercial Alfa Ltda");
      expect(await within(bar).findByText(/11\.222\.333\/0001-81/)).toBeInTheDocument();
      expect(within(bar).getByText("5 – Tabela Varejo")).toBeInTheDocument();
      expect(within(bar).getByText(/5\.000,00/)).toBeInTheDocument();
      expect(within(bar).getByText("Ativo")).toBeInTheDocument();
    });

    it("opens a modal with the five tabs over the order, without leaving it", async () => {
      const { user, router } = renderApp("/pedidos/novo?customer=1001", { handlers: fichaHandlers() });
      await user.click(await screen.findByRole("button", { name: "Ficha do cliente" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("heading", { name: /1001 – Comercial Alfa Ltda/ })).toBeInTheDocument();
      expect(within(dialog).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Dados cadastrais",
        "Financeiro",
        "Análise do cliente",
        "Engajamento",
        "Vendas",
      ]);
      expect(await within(dialog).findByText("11.222.333/0001-81")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("tab", { name: /Financeiro/ }));
      expect(await within(dialog).findByText(/5.000,00/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("tab", { name: /Vendas/ }));
      expect(await within(dialog).findByText("Rascunho nº 12")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("tab", { name: /Engajamento/ }));
      expect(within(dialog).getByText("Engajamento indisponível")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Fechar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(router.state.location.pathname).toBe("/pedidos/novo");
    });
  });

  it("tells the seller when the customer from the link cannot be loaded, and lets them pick one", async () => {
    renderApp("/pedidos/novo?customer=9", { handlers: newOrderHandlers({ "GET /customers/:code": apiError(404, "not_found", "x") }) });
    expect(await screen.findByText("Não foi possível carregar o cliente indicado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Cliente/ })).toBeEnabled();
  });

  it("offers a product only once and rejects an invalid quantity", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
    await addProduct(user, "Balão");
    expect(screen.getByRole("button", { name: "Carrinho (1)" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Produtos" }));
    expect(await screen.findByText("No carrinho: 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Adicionar Balão/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Carrinho/ }));

    const quantity = screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "2.5");
    expect(await screen.findByText("Use vírgula como separador decimal.")).toBeInTheDocument();
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  describe("Produtos | Carrinho", () => {
    const groupHandlers = (): Handlers =>
      newOrderHandlers({ "GET /product-groups": { body: { items: [{ code: 7, name: "Balões" }, { code: 8, name: "Velas" }] } } });

    it("filters the table by group and search on the server, for the selected customer's price table", async () => {
      const { user, calls } = renderApp("/pedidos/novo?customer=1001", { handlers: groupHandlers() });
      await screen.findByRole("button", { name: /^Adicionar .*Balão/ });
      await user.selectOptions(await screen.findByRole("combobox", { name: "Grupo" }), "7");
      await waitFor(() => expect(callsTo(calls, "GET", "/products").some((call) => call.search.get("group") === "7")).toBe(true));
      const filtered = callsTo(calls, "GET", "/products").find((call) => call.search.get("group") === "7");
      expect(filtered?.search.get("customerCode")).toBe("1001");
      expect(filtered?.search.get("sellable")).toBe("true");

      await user.type(screen.getByRole("searchbox", { name: "Buscar produto" }), "vela");
      await waitFor(() => expect(callsTo(calls, "GET", "/products").some((call) => call.search.get("search") === "vela")).toBe(true));
    });

    it("adds with the typed quantity (Enter or button), keeps the filters when switching views, and counts the cart", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: groupHandlers() });
      const search = await screen.findByRole("searchbox", { name: "Buscar produto" });
      await user.type(search, "bal");
      const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho a adicionar");
      await user.type(quantity, "2,5{Enter}");
      expect(await screen.findByText("No carrinho: 2,5")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Carrinho (1)" })).toHaveAttribute("aria-pressed", "false");

      await user.click(screen.getByRole("button", { name: "Carrinho (1)" }));
      expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveValue("2,5");
      expect(screen.queryByRole("searchbox", { name: "Buscar produto" })).not.toBeInTheDocument();
      expect(screen.getByTestId("order-total")).toHaveTextContent("31,25");

      await user.click(screen.getByRole("button", { name: "Produtos" }));
      expect(screen.getByRole("searchbox", { name: "Buscar produto" })).toHaveValue("bal");
    });

    it("refuses an invalid quantity in the table without adding the product", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: groupHandlers() });
      const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho a adicionar");
      await user.type(quantity, "2.5");
      await user.click(screen.getByRole("button", { name: /^Adicionar .*Balão/ }));
      expect(await screen.findByText("Use vírgula como separador decimal.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Carrinho (0)" })).toBeInTheDocument();
    });

    it("opens a saved order on the cart", async () => {
      renderApp(`/pedidos/${ORDER_ID}`, {
        handlers: newOrderHandlers({ "GET /orders/:id": { body: orderDetail({ items: [orderItem()] }) } }),
      });
      expect(await screen.findByRole("button", { name: "Carrinho (1)" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("fast entry", () => {
    const BALAO = "Quantidade de Balão látex 9 pol. vermelho";
    const VELA = "Quantidade de Vela sem preço";

    it("does not save the draft when Enter is pressed in a quantity; it moves to the next line, then to the product search", async () => {
      const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
        handlers: newOrderHandlers({ "POST /orders": { status: 201, body: orderDetail() } }),
      });
      await addProduct(user, "Balão");
      await addProduct(user, "Vela");
      const first = await screen.findByLabelText(BALAO);
      await user.click(first);
      await user.keyboard("{Enter}");
      expect(screen.getByLabelText(VELA)).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("searchbox", { name: "Buscar produto" })).toHaveFocus();
      expect(callsTo(calls, "POST", "/orders")).toHaveLength(0);
    });

    it("removes the selected lines and brings them back with Desfazer", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      await addProduct(user, "Balão");
      await addProduct(user, "Vela");
      await user.click(await screen.findByRole("checkbox", { name: "Selecionar Balão látex 9 pol. vermelho" }));
      expect(screen.getByText("1 item selecionado")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Remover selecionados" }));
      expect(screen.queryByLabelText(BALAO)).not.toBeInTheDocument();
      expect(screen.getByLabelText(VELA)).toBeInTheDocument();
      expect(screen.getByText("1 item removido.")).toBeInTheDocument();
      // The bar that had the focus is gone: the undo button takes it (keyboard users keep their place).
      expect(screen.getByRole("button", { name: "Desfazer" })).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "Desfazer" }));
      expect(screen.getByRole("button", { name: /^Carrinho/ })).toHaveFocus();
      expect(screen.getByLabelText(BALAO)).toBeInTheDocument();
      expect(screen.queryByText("1 item removido.")).not.toBeInTheDocument();
    });

    it("selects every line at once and sets the same quantity on them", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      await addProduct(user, "Balão");
      await addProduct(user, "Vela");
      await user.click(await screen.findByRole("checkbox", { name: "Selecionar todos os itens" }));
      expect(screen.getByText("2 itens selecionados")).toBeInTheDocument();
      const bulk = screen.getByLabelText("Quantidade para os selecionados");
      await user.type(bulk, "3,5");
      await user.click(screen.getByRole("button", { name: "Aplicar quantidade" }));
      expect(screen.getByLabelText(BALAO)).toHaveValue("3,5");
      expect(screen.getByLabelText(VELA)).toHaveValue("3,5");
    });

    it("asks before removing more than one selected line and keeps them when the seller declines", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      await addProduct(user, "Balão");
      await addProduct(user, "Vela");
      await user.click(await screen.findByRole("checkbox", { name: "Selecionar todos os itens" }));
      await user.click(screen.getByRole("button", { name: "Remover selecionados" }));
      const dialog = await screen.findByRole("dialog", { name: "Remover os itens selecionados?" });
      expect(within(dialog).getByText("2 itens serão removidos do carrinho.")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Manter itens" }));
      expect(screen.getByLabelText(BALAO)).toBeInTheDocument();
      expect(screen.getByLabelText(VELA)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Remover selecionados" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remover itens" }));
      expect(screen.queryByLabelText(BALAO)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(VELA)).not.toBeInTheDocument();
      expect(screen.getByText("2 itens removidos.")).toBeInTheDocument();
    });

    it("clears the whole cart only after confirmation and can undo it", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      await addProduct(user, "Balão");
      await addProduct(user, "Vela");
      await user.click(await screen.findByRole("button", { name: "Limpar carrinho" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Limpar o carrinho?" })).getByRole("button", { name: "Limpar carrinho" }));
      expect(screen.queryByLabelText(BALAO)).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Desfazer" }));
      expect(screen.getByLabelText(BALAO)).toBeInTheDocument();
      expect(screen.getByLabelText(VELA)).toBeInTheDocument();
    });

    it("shows the order summary: item count, quantity per unit and the estimated total", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      await addProduct(user, "Balão");
      await addProduct(user, "Vela");
      expect(await screen.findByLabelText("Resumo do pedido")).toBeInTheDocument();
      expect(screen.getByTestId("order-line-count")).toHaveTextContent("2");
      expect(screen.getByTestId("order-quantity").textContent).toMatch(/^2 /);
      expect(screen.getByTestId("order-total")).toBeInTheDocument();
    });

    it("refuses an invalid bulk quantity and leaves the lines untouched", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      await addProduct(user, "Balão");
      await user.click(await screen.findByRole("checkbox", { name: "Selecionar todos os itens" }));
      await user.type(screen.getByLabelText("Quantidade para os selecionados"), "0");
      await user.click(screen.getByRole("button", { name: "Aplicar quantidade" }));
      expect(await screen.findByText("A quantidade deve ser maior que zero.")).toBeInTheDocument();
      expect(screen.getByLabelText(BALAO)).toHaveValue("1");
    });
  });

  describe("lançamento múltiplo", () => {
    const balao = product({ code: 2001, description: "Balão látex 9 pol. vermelho", listPrice: pricedList("12.5") });
    const fita = product({ code: 2003, description: "Fita de cetim azul", listPrice: pricedList("3.2") });
    const resolutions = (request: { body?: unknown }) => {
      const { identifiers } = request.body as { identifiers: string[] };
      const items = identifiers.map((identifier): ApiSchema<"ProductResolutionItem"> => {
        if (identifier === "2001") return { identifier, status: "found", product: balao };
        if (identifier === "FITA-AZ") return { identifier, status: "found", product: fita };
        return { identifier, status: "not_found" };
      });
      return { body: { items, priceContext: { customerCode: 1001, tableCode: 1, tableName: "Referência", source: "customer_table" } } };
    };
    const open = async (user: ReturnType<typeof renderApp>["user"]) => {
      await user.click(await screen.findByRole("button", { name: "Lançamento múltiplo" }));
      return screen.findByRole("dialog", { name: "Lançamento múltiplo" });
    };
    const paste = async (user: ReturnType<typeof renderApp>["user"], dialog: HTMLElement, text: string) => {
      await user.click(within(dialog).getByRole("tab", { name: "Importar arquivo" }));
      await user.click(within(dialog).getByRole("textbox", { name: /Linhas/ }));
      await user.paste(text);
      await user.click(within(dialog).getByRole("button", { name: "Conferir" }));
    };

    it("needs a customer first", async () => {
      renderApp("/pedidos/novo", { handlers: newOrderHandlers() });
      expect(await screen.findByRole("button", { name: "Lançamento múltiplo" })).toBeDisabled();
    });

    it("returns focus to the trigger button after closing, whether by Escape or by adding items", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      const trigger = await screen.findByRole("button", { name: "Lançamento múltiplo" });

      await user.click(trigger);
      await screen.findByRole("dialog", { name: "Lançamento múltiplo" });
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: "Lançamento múltiplo" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();

      const dialog = await open(user);
      await user.click(await within(dialog).findByLabelText("Selecionar Balão látex 9 pol. vermelho"));
      await user.click(within(dialog).getByRole("button", { name: "Adicionar 1 item" }));
      expect(screen.queryByRole("dialog", { name: "Lançamento múltiplo" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("selects products from the list, with a quantity each, and adds them together", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      const dialog = await open(user);
      expect(within(dialog).getByRole("button", { name: "Adicionar 0 itens" })).toBeDisabled();
      await user.click(await within(dialog).findByLabelText("Selecionar Balão látex 9 pol. vermelho"));
      expect(within(dialog).getByRole("button", { name: "Adicionar 1 item" })).toBeEnabled();
      await user.type(within(dialog).getByLabelText("Quantidade de Balão látex 9 pol. vermelho"), "4");
      await user.click(within(dialog).getByRole("button", { name: "Adicionar 1 item" }));
      expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveValue("4");
      expect(screen.queryByRole("dialog", { name: "Lançamento múltiplo" })).not.toBeInTheDocument();
    });

    it("selects every orderable product of the page at once and defaults the quantity to 1", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      const dialog = await open(user);
      await user.click(await within(dialog).findByLabelText("Selecionar todos os produtos desta página"));
      await user.click(within(dialog).getByRole("button", { name: "Adicionar 2 itens" }));
      expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveValue("1");
      expect(screen.getByLabelText("Quantidade de Vela sem preço")).toHaveValue("1");
    });

    it("does not let a product without price be selected when the installation forbids it", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", {
        handlers: newOrderHandlers(
          withOrderEntryConfiguration((config) => ({ ...config, sales: { ...config.sales, orderBehavior: { allowDraftWithoutPrice: false } } })),
        ),
      });
      const dialog = await open(user);
      expect(await within(dialog).findByLabelText("Selecionar Vela sem preço")).toBeDisabled();
      expect(within(dialog).getByLabelText("Selecionar Balão látex 9 pol. vermelho")).toBeEnabled();
    });

    it("blocks adding while a selected quantity is invalid", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
      const dialog = await open(user);
      await user.type(await within(dialog).findByLabelText("Quantidade de Balão látex 9 pol. vermelho"), "0");
      expect(await within(dialog).findByText("A quantidade deve ser maior que zero.")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Adicionar 1 item" })).toBeDisabled();
    });

    it("resolves the pasted lines on the server, shows what each one does and adds only the good ones", async () => {
      const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
        handlers: newOrderHandlers({ "POST /product-resolutions": resolutions }),
      });
      const dialog = await open(user);
      await paste(user, dialog, "2001;5\nFITA-AZ;2,5\nNADA;1\n2001;9");
      const summary = (await within(dialog).findByText("2 itens serão adicionados")).parentElement;
      expect(summary).toHaveTextContent("2 itens serão adicionados; 2 linhas ficam de fora (motivo em cada linha).");
      expect(within(dialog).getByText("Produto não encontrado.")).toBeInTheDocument();
      expect(within(dialog).getByText("Produto repetido nas linhas: só a primeira ocorrência entra.")).toBeInTheDocument();
      const [request] = callsTo(calls, "POST", "/product-resolutions");
      expect(request?.body).toEqual({ customerCode: 1001, identifiers: ["2001", "FITA-AZ", "NADA", "2001"] });

      await user.click(within(dialog).getByRole("button", { name: "Adicionar 2 itens" }));
      expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveValue("5");
      expect(screen.getByLabelText("Quantidade de Fita de cetim azul")).toHaveValue("2,5");
      expect(screen.queryByRole("dialog", { name: "Lançamento múltiplo" })).not.toBeInTheDocument();
    });

    it("never sends lines with an invalid quantity and keeps them out of the order", async () => {
      const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
        handlers: newOrderHandlers({ "POST /product-resolutions": resolutions }),
      });
      const dialog = await open(user);
      await paste(user, dialog, "2001;0");
      expect(await within(dialog).findByText("A quantidade deve ser maior que zero.")).toBeInTheDocument();
      expect(callsTo(calls, "POST", "/product-resolutions")).toHaveLength(0);
      expect(within(dialog).getByRole("button", { name: "Adicionar 0 itens" })).toBeDisabled();
    });

    it("does not add a product that is already in the order", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", {
        handlers: newOrderHandlers({ "POST /product-resolutions": resolutions }),
      });
      await addProduct(user, "Balão");
      const dialog = await open(user);
      await paste(user, dialog, "2001;4");
      expect(await within(dialog).findByText("Produto já está no pedido.")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Adicionar 0 itens" })).toBeDisabled();
    });

    it("tells the seller when the lookup fails and adds nothing", async () => {
      const { user } = renderApp("/pedidos/novo?customer=1001", {
        handlers: newOrderHandlers({ "POST /product-resolutions": apiError(500, "internal_error", "Falha") }),
      });
      const dialog = await open(user);
      await paste(user, dialog, "2001;1");
      expect(await within(dialog).findByText("Não foi possível conferir os produtos")).toBeInTheDocument();
      expect(screen.queryByLabelText("Quantidade de Balão látex 9 pol. vermelho")).not.toBeInTheDocument();
    });
  });

  it("saves with product and quantity only (no price in the request) and opens the saved draft", async () => {
    const { user, calls, router } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers({
        "POST /orders": { status: 201, body: orderDetail() },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await addProduct(user, "Balão");
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));
    const [created] = callsTo(calls, "POST", "/orders");
    expect(created?.body).toMatchObject({ customerCode: 1001, items: [{ productCode: 2001, quantity: "2" }] });
    expect(JSON.stringify(created?.body)).not.toMatch(/price|preco|total/i);
    expect(created?.body).toHaveProperty("clientRequestId", expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(created?.body).toHaveProperty("expectedDataset", testDataset);
    expect(await screen.findByRole("heading", { name: /^Rascunho nº 12/ })).toBeInTheDocument();
  });

  it("resends the same idempotency key when a failed save is retried unchanged", async () => {
    let attempts = 0;
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers({
        "POST /orders": () => {
          attempts += 1;
          return attempts === 1
            ? apiError(503, "service_unavailable", "x", { requestId: "req-s-1" })
            : { status: 201, body: orderDetail() };
        },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await addProduct(user, "Balão");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("req-s-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/orders")).toHaveLength(2));
    const [first, second] = callsTo(calls, "POST", "/orders").map((call) => (call.body as { clientRequestId: string }).clientRequestId);
    expect(first).toBe(second);
  });

  it("lists the server's item issues in Portuguese when the save is rejected", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers({
        "POST /orders": apiError(422, "validation_failed", "x", {
          issues: [{ path: "items[0]", code: "product_not_sellable" }],
          requestId: "req-v-1",
        }),
      }),
    });
    await addProduct(user, "Balão");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("Corrija os itens antes de salvar")).toBeInTheDocument();
    expect(screen.getByText("Item 1: Produto indisponível para venda.")).toBeInTheDocument();
  });

  it("blocks saving a line without price when the installation does not allow it", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers(
        withOrderEntryConfiguration((config) => ({ ...config, sales: { ...config.sales, orderBehavior: { allowDraftWithoutPrice: false } } })),
      ),
    });
    await addProduct(user, "Vela");
    expect(await screen.findByText("Este item não pode ser pedido sem preço nesta instalação.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
    expect(screen.getByTestId("save-blocked-reason")).toHaveTextContent("Remova os itens sem preço para salvar.");
  });

  it("warns and blocks saving when the installation is not enabled for orders", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers(withOrderEntryConfiguration((config) => ({ ...config, general: { ...config.general, enabled: false } }))),
    });
    expect(await screen.findByText("Pedidos ainda não habilitados")).toBeInTheDocument();
    await addProduct(user, "Balão");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("asks for confirmation before leaving with unsaved changes", async () => {
    const { user, router } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers({ "GET /orders": { body: { items: [], page: 1, pageSize: 25, total: 0 } } }),
    });
    await addProduct(user, "Balão");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    const dialog = await screen.findByRole("dialog", { name: "Sair sem salvar?" });
    await user.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    expect(router.state.location.pathname).toBe("/pedidos/novo");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Sair sem salvar?" })).getByRole("button", { name: "Sair sem salvar" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/pedidos"));
  });

  it("renders neither cost nor margin", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
    await addProduct(user, "Balão");
    expect(document.body.textContent).not.toMatch(FORBIDDEN_TERMS);
  });
});

// Regression coverage for the fix to a real bug: order-editor used to call the admin-only GET /configuration,
// which 403s for sellers/managers. It must use the dedicated, session-scoped GET /order-entry/configuration.
describe("order-entry configuration source", () => {
  it("loads via GET /order-entry/configuration, never the admin-only GET /configuration", async () => {
    const { calls } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
    await screen.findByRole("heading", { name: /^Novo pedido/ });
    await waitFor(() => expect(callsTo(calls, "GET", "/order-entry/configuration")).toHaveLength(1));
    expect(callsTo(calls, "GET", "/configuration")).toHaveLength(0);
  });

  it("populates the negotiation type selector from the endpoint response", async () => {
    renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers(
        withOrderEntryConfiguration((config) => ({
          ...config,
          sales: {
            ...config.sales,
            defaultNegotiationTypeCode: 9,
            negotiationTypes: [
              { code: 9, label: "Faturado 60 dias" },
              { code: 10, label: "Cartão" },
            ],
          },
        })),
      ),
    });
    const select = await screen.findByRole("combobox", { name: "Tipo de negociação" });
    await waitFor(() => expect(select).toBeEnabled());
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Não informado",
      "Faturado 60 dias",
      "Cartão",
    ]);
    expect(select).toHaveValue("9");
  });

  it("does not silently fall back to an empty configuration when the endpoint succeeds", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers(
        withOrderEntryConfiguration((config) => ({ ...config, sales: { ...config.sales, orderBehavior: { allowDraftWithoutPrice: false } } })),
      ),
    });
    // If the response were silently ignored, the installation's real "no price = not orderable" rule would not apply.
    await addProduct(user, "Vela");
    expect(await screen.findByText("Este item não pode ser pedido sem preço nesta instalação.")).toBeInTheDocument();
  });
});

describe("Rascunho existente", () => {
  const existing = (order = orderDetail(), extra: Handlers = {}): Handlers => ({
    "GET /orders/:id": { body: order },
    "GET /products": { body: catalog },
    "GET /customers/:code": { body: customerDetail() },
    "GET /customers": { body: customersPage([customer()]) },
    ...extra,
  });

  it("loads the saved items with the prices and totals sent by the server", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: existing() });
    expect(await screen.findByRole("heading", { name: /^Rascunho nº 12/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveValue("2");
    expect(screen.getByTestId("order-total")).toHaveTextContent("25,00");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("ends the submit action in the 'ERP submission disabled' message, never a success", async () => {
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), {
        "POST /orders/:id/submit": apiError(409, "erp_submission_disabled", "Envio desabilitado.", { requestId: "req-sub-1" }),
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Enviar ao ERP" }));
    expect(await screen.findByText(SUBMIT_DISABLED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText("Envio ao ERP indisponível")).toBeInTheDocument();
    expect(callsTo(calls, "POST", `/orders/${ORDER_ID}/submit`)).toHaveLength(1);
    expect(screen.queryByText(/enviado com sucesso|pedido enviado/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Rascunho salvo")).not.toBeInTheDocument();
  });

  it("shows other submit failures as errors with the correlation id", async () => {
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), {
        "POST /orders/:id/submit": apiError(503, "service_unavailable", "x", { requestId: "req-sub-2" }),
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Enviar ao ERP" }));
    expect(await screen.findByText("req-sub-2")).toBeInTheDocument();
    expect(screen.queryByText(SUBMIT_DISABLED_MESSAGE)).not.toBeInTheDocument();
  });

  it("requires saving before submitting", async () => {
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, { handlers: existing() });
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "3");
    expect(screen.getByRole("button", { name: "Enviar ao ERP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled();
  });

  it("replaces the draft with the expected version and shows the saved result", async () => {
    const saved = orderDetail({
      version: 2,
      items: [orderItem({ quantity: "3", estimatedLineTotal: "37.5" })],
      totals: { estimatedTotal: "37.5", lineCount: 1, unpricedLineCount: 0, isPartial: false },
    });
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), { "PUT /orders/:id": { body: saved } }),
    });
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("Rascunho salvo")).toBeInTheDocument();
    const [put] = callsTo(calls, "PUT", `/orders/${ORDER_ID}`);
    expect(put?.body).toMatchObject({ expectedVersion: 1, customerCode: 1001, items: [{ productCode: 2001, quantity: "3" }] });
    expect(put?.body).toHaveProperty("expectedDataset", testDataset);
    expect(await screen.findByTestId("order-total")).toHaveTextContent("37,50");
  });

  it("offers a reload on a version conflict", async () => {
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), { "PUT /orders/:id": apiError(409, "version_conflict", "x", { requestId: "req-vc-1" }) }),
    });
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("O rascunho foi alterado em outro lugar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
  });

  it("is read-only once the order is no longer a draft", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: existing(orderDetail({ status: "sent", erpNumber: 555 })) });
    expect(await screen.findByText("Somente leitura")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar ao ERP" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveAttribute("readonly");
  });

  it("discards the draft from the editor and returns to the list", async () => {
    const { user, router, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), {
        "DELETE /orders/:id": { body: orderDetail({ status: "cancelled" }) },
        "GET /orders": { body: { items: [], page: 1, pageSize: 25, total: 0 } },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Descartar" }));
    const dialog = await screen.findByRole("dialog", { name: "Descartar rascunho?" });
    await user.click(within(dialog).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/pedidos"));
    expect(callsTo(calls, "DELETE", `/orders/${ORDER_ID}`)).toHaveLength(1);
  });

  it("shows not found and forbidden states", async () => {
    const notFound = renderApp(`/pedidos/${ORDER_ID}`, { handlers: { "GET /orders/:id": apiError(404, "not_found", "x") } });
    expect(await screen.findByText("Não encontrado")).toBeInTheDocument();
    notFound.unmount();
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: { "GET /orders/:id": apiError(403, "forbidden", "x") } });
    expect(await screen.findByText("Sem permissão")).toBeInTheDocument();
  });

  it("shows a loading state while the draft loads", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: { "GET /orders/:id": () => new Promise(() => undefined) } });
    expect(await screen.findByText("Carregando pedido…")).toBeInTheDocument();
  });
});
