import type { ApiSchema } from "@salesforce/contracts/client";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ORDER_ID,
  TEMPLATE_ID,
  customer,
  customerDetail,
  customersPage,
  orderDetail,
  orderTemplate,
  orderTemplateDetail,
  orderTemplatesPage,
  ordersPage,
  pricedList,
  product,
  productsPage,
} from "../test/fixtures";
import { queryKeys } from "../lib/api-queries";
import { apiError, callsTo, renderApp, type Handlers, type MockRequest } from "../test/harness";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = /price|preco|preço|discount|desconto|cost|custo|margin|margem|total/i;

/** Every key of a request body, recursively: a template request may carry product and quantity only. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}
const expectNoMoneyKeys = (body: unknown) => expect(keysOf(body).filter((key) => FORBIDDEN_KEYS.test(key))).toEqual([]);

const balao = product({ code: 2001, description: "Balão látex 9 pol. vermelho", listPrice: pricedList("12.5") });
const fita = product({ code: 2003, description: "Fita de cetim azul", listPrice: pricedList("3.2") });

const resolutions = (request: MockRequest) => {
  const { identifiers } = request.body as { identifiers: string[] };
  const items = identifiers.map((identifier): ApiSchema<"ProductResolutionItem"> => {
    if (identifier === "2001") return { identifier, status: "found", product: balao };
    if (identifier === "2003") return { identifier, status: "found", product: fita };
    return { identifier, status: "not_found" };
  });
  return { body: { items, priceContext: { customerCode: 1001, tableCode: 5, tableName: "Varejo", source: "customer" } } };
};

const customerPageHandlers = (extra: Handlers = {}): Handlers => ({
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
  "GET /customers/:code/order-templates": { body: orderTemplatesPage([orderTemplate()]) },
  ...extra,
});

describe("Cliente: Pedidos recorrentes", () => {
  it("lists the templates with name, item count and pt-BR date, and accessible actions", async () => {
    renderApp("/clientes/1001", { handlers: customerPageHandlers() });
    const table = await screen.findByRole("table", { name: "Pedidos recorrentes do cliente" });
    const row = within(table).getByText("Reposição mensal").closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent(/^Reposição mensal$/);
    expect(cells[1]).toHaveTextContent(/^2$/);
    expect(cells[2]).toHaveTextContent("15/09/2026");
    expect(screen.getByRole("heading", { name: "Pedidos recorrentes" })).toBeInTheDocument();
    for (const action of ["Usar modelo Reposição mensal", "Editar modelo Reposição mensal", "Apagar modelo Reposição mensal"]) {
      expect(within(row).getByRole("button", { name: action })).toBeInTheDocument();
    }
    expect(row).toHaveTextContent("Usar");
  });

  it("shows an empty state that explains how to create one", async () => {
    renderApp("/clientes/1001", {
      handlers: customerPageHandlers({ "GET /customers/:code/order-templates": { body: orderTemplatesPage([]) } }),
    });
    expect(await screen.findByText("Nenhum pedido recorrente para este cliente")).toBeInTheDocument();
    expect(screen.getByText(/Salvar como recorrente/)).toBeInTheDocument();
  });

  it("shows a recoverable error when the list fails", async () => {
    renderApp("/clientes/1001", {
      handlers: customerPageHandlers({
        "GET /customers/:code/order-templates": apiError(500, "internal_error", "x", { requestId: "req-77" }),
      }),
    });
    expect(await screen.findByText("Não foi possível carregar os pedidos recorrentes")).toBeInTheDocument();
    expect(screen.getByText("req-77")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeInTheDocument();
  });

  describe("Usar", () => {
    it("creates a draft with only a fresh clientRequestId, opens it and lists the lines that were left out", async () => {
      const { user, calls, router } = renderApp("/clientes/1001", {
        handlers: customerPageHandlers({
          "POST /order-templates/:id/use": {
            status: 201,
            body: {
              order: orderDetail(),
              skippedLines: [
                { lineNo: 2, productCode: 2003, reason: "product_removed" },
                { lineNo: 3, productCode: 2004, reason: "no_price" },
              ],
            } satisfies ApiSchema<"UseOrderTemplateResponse">,
          },
          "GET /orders/:id": { body: orderDetail() },
        }),
      });
      await user.click(await screen.findByRole("button", { name: "Usar modelo Reposição mensal" }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));

      const [request] = callsTo(calls, "POST", `/order-templates/${TEMPLATE_ID}/use`);
      expect(Object.keys(request?.body as object)).toEqual(["clientRequestId"]);
      expect((request?.body as { clientRequestId: string }).clientRequestId).toMatch(UUID);

      const notice = await screen.findByRole("alert", { name: "Itens do modelo que ficaram de fora" });
      expect(notice).toHaveTextContent("2 itens do modelo não entraram no pedido");
      expect(notice).toHaveTextContent("Código 2003: Produto removido do catálogo");
      expect(notice).toHaveTextContent("Código 2004: Produto sem preço para este cliente");
      // Non-blocking: the editor is usable next to it, and the notice can be dismissed.
      expect(await screen.findByRole("heading", { name: /Rascunho nº 12/ })).toBeInTheDocument();
      await user.click(within(notice).getByRole("button", { name: "Dispensar aviso" }));
      expect(screen.queryByRole("alert", { name: "Itens do modelo que ficaram de fora" })).not.toBeInTheDocument();
    });

    it("opens the draft with a confirmation and no notice when every line was used", async () => {
      const { user, router } = renderApp("/clientes/1001", {
        handlers: customerPageHandlers({
          "POST /order-templates/:id/use": { status: 201, body: { order: orderDetail(), skippedLines: [] } },
          "GET /orders/:id": { body: orderDetail() },
        }),
      });
      await user.click(await screen.findByRole("button", { name: "Usar modelo Reposição mensal" }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));
      expect(await screen.findByText("Rascunho criado a partir do modelo")).toBeInTheDocument();
      expect(screen.queryByRole("alert", { name: "Itens do modelo que ficaram de fora" })).not.toBeInTheDocument();
    });

    it("shows no template notice on a direct visit to a draft", async () => {
      renderApp(`/pedidos/${ORDER_ID}`, { handlers: { "GET /orders/:id": { body: orderDetail() } } });
      expect(await screen.findByRole("heading", { name: /Rascunho nº 12/ })).toBeInTheDocument();
      expect(screen.queryByRole("alert", { name: "Itens do modelo que ficaram de fora" })).not.toBeInTheDocument();
    });

    const useIds = (calls: MockRequest[]) =>
      callsTo(calls, "POST", `/order-templates/${TEMPLATE_ID}/use`).map(
        (call) => (call.body as { clientRequestId: string }).clientRequestId,
      );

    it("reuses the request id after a network error, a 5xx and a 429, and uses a new one for the next use after success", async () => {
      let attempt = 0;
      const { user, calls, router } = renderApp("/clientes/1001", {
        handlers: customerPageHandlers({
          "POST /order-templates/:id/use": () => {
            attempt += 1;
            if (attempt === 1) throw new TypeError("Failed to fetch");
            if (attempt === 2) return apiError(503, "service_unavailable", "x");
            if (attempt === 3) return apiError(429, "too_many_requests", "x");
            return { status: 201, body: { order: orderDetail(), skippedLines: [] } };
          },
          "GET /orders/:id": { body: orderDetail() },
        }),
      });
      const click = async () => user.click(await screen.findByRole("button", { name: "Usar modelo Reposição mensal" }));
      await click();
      expect(await screen.findByText("Sem conexão com o servidor")).toBeInTheDocument();
      await click();
      expect(await screen.findByText("Serviço indisponível")).toBeInTheDocument();
      await click();
      expect(await screen.findByText("Muitas requisições")).toBeInTheDocument();
      await click();
      await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));

      const ids = useIds(calls);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(1);

      // The draft was created: using the template again is a new draft, with a new key.
      act(() => router.history.back());
      await waitFor(() => expect(router.state.location.pathname).toBe("/clientes/1001"));
      await click();
      await waitFor(() => expect(useIds(calls)).toHaveLength(5));
      expect(useIds(calls)[4]).not.toBe(ids[0]);
    });

    it("explains a version_conflict of the template when using it, without form wording, and refreshes the list", async () => {
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: customerPageHandlers({ "POST /order-templates/:id/use": apiError(409, "version_conflict", "stale") }),
      });
      await user.click(await screen.findByRole("button", { name: "Usar modelo Reposição mensal" }));
      expect(await screen.findByText("O modelo mudou")).toBeInTheDocument();
      expect(screen.getByText(/tente novamente/)).toBeInTheDocument();
      expect(screen.queryByText(/Recarregue|descartadas/)).not.toBeInTheDocument();
      await waitFor(() => expect(callsTo(calls, "GET", "/customers/1001/order-templates")).toHaveLength(2));
    });

    it("refreshes the list when the template is gone (404) when using it", async () => {
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: customerPageHandlers({ "POST /order-templates/:id/use": apiError(404, "not_found", "x") }),
      });
      await user.click(await screen.findByRole("button", { name: "Usar modelo Reposição mensal" }));
      expect(await screen.findByText("Não encontrado")).toBeInTheDocument();
      await waitFor(() => expect(callsTo(calls, "GET", "/customers/1001/order-templates")).toHaveLength(2));
    });

    it("explains a 409 no_usable_lines, lists why, creates nothing and stays on the page; a second click uses a new request id", async () => {
      const { user, calls, router } = renderApp("/clientes/1001", {
        handlers: customerPageHandlers({
          "POST /order-templates/:id/use": apiError(409, "conflict", "Nenhum item", {
            details: { reason: "no_usable_lines", skippedLines: [{ lineNo: 1, productCode: 2001, reason: "product_inactive" }] },
          }),
        }),
      });
      const button = await screen.findByRole("button", { name: "Usar modelo Reposição mensal" });
      await user.click(button);
      expect(await screen.findByText("Nenhum item do modelo pode ser pedido agora")).toBeInTheDocument();
      expect(screen.getByText(/Nenhum pedido foi criado/)).toBeInTheDocument();
      expect(screen.getByText(/Código 2001: Produto inativo/)).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/clientes/1001");

      await user.click(screen.getByRole("button", { name: "Usar modelo Reposição mensal" }));
      await waitFor(() => expect(callsTo(calls, "POST", `/order-templates/${TEMPLATE_ID}/use`)).toHaveLength(2));
      const [first, second] = callsTo(calls, "POST", `/order-templates/${TEMPLATE_ID}/use`);
      expect((first?.body as { clientRequestId: string }).clientRequestId).not.toBe(
        (second?.body as { clientRequestId: string }).clientRequestId,
      );
    });
  });

  describe("Editar", () => {
    const editHandlers = (extra: Handlers = {}) =>
      customerPageHandlers({
        "GET /order-templates/:id": { body: orderTemplateDetail() },
        "POST /product-resolutions": resolutions,
        "GET /products": { body: productsPage([balao, fita]) },
        ...extra,
      });
    const openDialog = async (user: ReturnType<typeof renderApp>["user"]) => {
      await user.click(await screen.findByRole("button", { name: "Editar modelo Reposição mensal" }));
      return screen.findByRole("dialog", { name: "Editar modelo recorrente" });
    };

    it("loads the items with their descriptions, saves name and lines with expectedVersion and no prices", async () => {
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: editHandlers({ "PUT /order-templates/:id": { body: orderTemplateDetail({ version: 2, name: "Reposição semanal" }) } }),
      });
      const dialog = await openDialog(user);
      expect(await within(dialog).findByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveValue("5");
      expect(await within(dialog).findByLabelText("Quantidade de Fita de cetim azul")).toHaveValue("2,5");

      const name = within(dialog).getByRole("textbox", { name: /Nome do modelo/ });
      await user.clear(name);
      await user.type(name, "  Reposição semanal ");
      const quantity = within(dialog).getByLabelText("Quantidade de Balão látex 9 pol. vermelho");
      await user.clear(quantity);
      await user.type(quantity, "7");
      await user.click(within(dialog).getByRole("button", { name: "Remover Fita de cetim azul" }));
      await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));

      await waitFor(() => expect(callsTo(calls, "PUT", `/order-templates/${TEMPLATE_ID}`)).toHaveLength(1));
      const [put] = callsTo(calls, "PUT", `/order-templates/${TEMPLATE_ID}`);
      expect(put?.body).toEqual({ expectedVersion: 1, name: "Reposição semanal", items: [{ productCode: 2001, quantity: "7" }] });
      expectNoMoneyKeys(put?.body);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar modelo recorrente" })).not.toBeInTheDocument());
      expect(await screen.findByText("Modelo atualizado")).toBeInTheDocument();
    });

    it("adds a product with the existing picker", async () => {
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: editHandlers({
          "GET /order-templates/:id": { body: orderTemplateDetail({ items: [{ productCode: 2001, quantity: "5" }] }) },
          "PUT /order-templates/:id": { body: orderTemplateDetail({ version: 2 }) },
        }),
      });
      const dialog = await openDialog(user);
      const combobox = await within(dialog).findByRole("combobox", { name: /Adicionar produto/ });
      await user.click(combobox);
      await user.click(await screen.findByRole("option", { name: /Fita de cetim azul/ }));
      expect(within(dialog).getByLabelText("Quantidade de Fita de cetim azul")).toHaveValue("1");
      await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
      await waitFor(() => expect(callsTo(calls, "PUT", `/order-templates/${TEMPLATE_ID}`)).toHaveLength(1));
      expect(callsTo(calls, "PUT", `/order-templates/${TEMPLATE_ID}`)[0]?.body).toEqual({
        expectedVersion: 1,
        name: "Reposição mensal",
        items: [
          { productCode: 2001, quantity: "5" },
          { productCode: 2003, quantity: "1" },
        ],
      });
    });

    it("validates quantity and empty lists before sending anything", async () => {
      const { user, calls } = renderApp("/clientes/1001", { handlers: editHandlers() });
      const dialog = await openDialog(user);
      const quantity = await within(dialog).findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
      await user.clear(quantity);
      await user.type(quantity, "0");
      await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
      expect(await within(dialog).findByText("A quantidade deve ser maior que zero.")).toBeInTheDocument();
      expect(quantity).toHaveAttribute("aria-invalid", "true");
      expect(callsTo(calls, "PUT", `/order-templates/${TEMPLATE_ID}`)).toHaveLength(0);
    });

    it("explains a stale version (409 version_conflict) and reloads the current one on request", async () => {
      let version = 1;
      const { user } = renderApp("/clientes/1001", {
        handlers: editHandlers({
          "GET /order-templates/:id": () => ({
            body: orderTemplateDetail({ version, name: version === 1 ? "Reposição mensal" : "Nome novo de outra pessoa" }),
          }),
          "PUT /order-templates/:id": apiError(409, "version_conflict", "stale", { requestId: "req-9" }),
        }),
      });
      const dialog = await openDialog(user);
      await within(dialog).findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
      await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
      expect(await within(dialog).findByText("O modelo foi alterado por outra pessoa")).toBeInTheDocument();
      expect(within(dialog).getByText("O modelo mudou desde que foi aberto.")).toBeInTheDocument();
      expect(within(dialog).getByText("req-9")).toBeInTheDocument();

      version = 2;
      await user.click(within(dialog).getByRole("button", { name: "Recarregar" }));
      // The form restarts from the authoritative data (a new dialog content), without the conflict message.
      await waitFor(() => expect(screen.getByRole("textbox", { name: /Nome do modelo/ })).toHaveValue("Nome novo de outra pessoa"));
      expect(screen.queryByText("O modelo foi alterado por outra pessoa")).not.toBeInTheDocument();
    });

    it("shows a taken name on the name field", async () => {
      const { user } = renderApp("/clientes/1001", {
        handlers: editHandlers({
          "PUT /order-templates/:id": apiError(409, "conflict", "x", { details: { reason: "template_name_taken" } }),
        }),
      });
      const dialog = await openDialog(user);
      await within(dialog).findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
      await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
      const field = await within(dialog).findByText("Já existe um modelo com este nome para este cliente.");
      expect(within(dialog).getByRole("textbox", { name: /Nome do modelo/ })).toHaveAttribute("aria-invalid", "true");
      expect(field).toBeInTheDocument();
      // Reported once, on the field: no second alert repeating it.
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(dialog).queryByText("Já existe um modelo com este nome")).not.toBeInTheDocument();
    });

    it("shows the error state when the template cannot be loaded (deleted meanwhile) and refreshes the list", async () => {
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: editHandlers({ "GET /order-templates/:id": apiError(404, "not_found", "x") }),
      });
      const dialog = await openDialog(user);
      expect(await within(dialog).findByText("Não encontrado")).toBeInTheDocument();
      await waitFor(() => expect(callsTo(calls, "GET", "/customers/1001/order-templates")).toHaveLength(2));
    });

    it("refreshes the list when saving finds the template gone (404)", async () => {
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: editHandlers({ "PUT /order-templates/:id": apiError(404, "not_found", "x") }),
      });
      const dialog = await openDialog(user);
      await within(dialog).findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
      await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
      expect(await within(dialog).findByText("Não encontrado")).toBeInTheDocument();
      await waitFor(() => expect(callsTo(calls, "GET", "/customers/1001/order-templates")).toHaveLength(2));
    });

    it("does not render a cached copy: the form starts from the version the server has now and keeps what is typed", async () => {
      // Held open deterministically (no arbitrary delay racing testing-library's polling interval) so the loading
      // state can be asserted before the fetch settles.
      let resolveFetch: (response: { body: ApiSchema<"OrderTemplateDetail"> }) => void = () => {};
      const fetched = new Promise<{ body: ApiSchema<"OrderTemplateDetail"> }>((resolve) => {
        resolveFetch = resolve;
      });
      const { user } = renderApp("/clientes/1001", {
        gcTime: Infinity,
        prepare: (queryClient) =>
          queryClient.setQueryData(queryKeys.orderTemplate(TEMPLATE_ID), orderTemplateDetail({ version: 2, name: "Nome da versão 2" })),
        handlers: editHandlers({ "GET /order-templates/:id": () => fetched }),
      });
      await user.click(await screen.findByRole("button", { name: "Editar modelo Reposição mensal" }));
      const dialog = await screen.findByRole("dialog", { name: "Editar modelo recorrente" });
      // The stale v2 is never offered as a form while the fetch made on open is in flight.
      expect(within(dialog).queryByRole("textbox", { name: /Nome do modelo/ })).not.toBeInTheDocument();
      resolveFetch({ body: orderTemplateDetail({ version: 3, name: "Nome da versão 3" }) });
      const name = await within(dialog).findByRole("textbox", { name: /Nome do modelo/ });
      expect(name).toHaveValue("Nome da versão 3");
      await user.type(name, " editado");
      // Nothing re-keys the form behind the typing.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(within(dialog).getByRole("textbox", { name: /Nome do modelo/ })).toHaveValue("Nome da versão 3 editado");
    });

    it("blocks Enter from submitting via the product search or a quantity, but not via the name field", async () => {
      // user-event's Enter-submits-form simulation only fires the submit button it finds as a DOM descendant of
      // the <form> (querySelector), or as a fallback when the form has exactly one <input>. This form's submit
      // button lives in the dialog footer, associated only via the HTML `form` attribute (a sibling, not a
      // descendant), and the form has several inputs — so neither jsdom path applies even though real browsers
      // do submit in that case. We exercise the guard itself (via the keydown's defaultPrevented) and the
      // onSubmit wiring (via a direct native `submit`) instead of relying on that incomplete emulation.
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: editHandlers({ "PUT /order-templates/:id": { body: orderTemplateDetail({ version: 2 }) } }),
      });
      const dialog = await openDialog(user);

      const quantity = await within(dialog).findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
      expect(fireEvent.keyDown(quantity, { key: "Enter", bubbles: true, cancelable: true })).toBe(false);

      const search = within(dialog).getByRole("combobox", { name: /Adicionar produto/ });
      expect(fireEvent.keyDown(search, { key: "Enter", bubbles: true, cancelable: true })).toBe(false);

      const name = within(dialog).getByRole("textbox", { name: /Nome do modelo/ });
      expect(fireEvent.keyDown(name, { key: "Enter", bubbles: true, cancelable: true })).toBe(true);
      expect(callsTo(calls, "PUT", `/order-templates/${TEMPLATE_ID}`)).toHaveLength(0);
      expect(screen.getByRole("dialog", { name: "Editar modelo recorrente" })).toBeInTheDocument();

      const form = name.closest("form");
      if (!form) throw new Error("name field is not inside the template form");
      fireEvent.submit(form);
      await waitFor(() => expect(callsTo(calls, "PUT", `/order-templates/${TEMPLATE_ID}`)).toHaveLength(1));
    });
  });

  describe("Apagar", () => {
    it("asks for confirmation first and only then deletes and refreshes the list", async () => {
      let templates = [orderTemplate()];
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: customerPageHandlers({
          "GET /customers/:code/order-templates": () => ({ body: orderTemplatesPage(templates) }),
          "DELETE /order-templates/:id": () => {
            templates = [];
            return { status: 204 };
          },
        }),
      });
      await user.click(await screen.findByRole("button", { name: "Apagar modelo Reposição mensal" }));
      const dialog = await screen.findByRole("dialog", { name: "Apagar modelo recorrente?" });
      expect(dialog).toHaveTextContent("Reposição mensal");
      expect(callsTo(calls, "DELETE", `/order-templates/${TEMPLATE_ID}`)).toHaveLength(0);

      await user.click(within(dialog).getByRole("button", { name: "Apagar" }));
      await waitFor(() => expect(callsTo(calls, "DELETE", `/order-templates/${TEMPLATE_ID}`)).toHaveLength(1));
      expect(await screen.findByText("Nenhum pedido recorrente para este cliente")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Apagar modelo recorrente?" })).not.toBeInTheDocument();
    });

    it("keeps the template when the seller declines", async () => {
      const { user, calls } = renderApp("/clientes/1001", { handlers: customerPageHandlers() });
      await user.click(await screen.findByRole("button", { name: "Apagar modelo Reposição mensal" }));
      const dialog = await screen.findByRole("dialog", { name: "Apagar modelo recorrente?" });
      await user.click(within(dialog).getByRole("button", { name: "Manter modelo" }));
      expect(callsTo(calls, "DELETE", `/order-templates/${TEMPLATE_ID}`)).toHaveLength(0);
      expect(screen.getByText("Reposição mensal")).toBeInTheDocument();
    });

    it("reports a failure inside the dialog instead of closing silently", async () => {
      const { user } = renderApp("/clientes/1001", {
        handlers: customerPageHandlers({ "DELETE /order-templates/:id": apiError(500, "internal_error", "x", { requestId: "req-5" }) }),
      });
      await user.click(await screen.findByRole("button", { name: "Apagar modelo Reposição mensal" }));
      const dialog = await screen.findByRole("dialog", { name: "Apagar modelo recorrente?" });
      await user.click(within(dialog).getByRole("button", { name: "Apagar" }));
      expect(await within(dialog).findByText("Não foi possível apagar o modelo")).toBeInTheDocument();
      expect(within(dialog).getByText("req-5")).toBeInTheDocument();
    });
  });
});

describe("Editor de pedido: Salvar como recorrente", () => {
  const editorHandlers = (extra: Handlers = {}): Handlers => ({
    "GET /customers/:code": { body: customerDetail() },
    "GET /customers": { body: customersPage([customer()]) },
    "GET /products": { body: productsPage([balao, fita]) },
    ...extra,
  });
  const addProduct = async (user: ReturnType<typeof renderApp>["user"], description: string) => {
    const combobox = await screen.findByRole("combobox", { name: /Adicionar produto/ });
    await waitFor(() => expect(combobox).toBeEnabled());
    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: new RegExp(description) }));
  };
  const openSave = async (user: ReturnType<typeof renderApp>["user"]) => {
    await user.click(await screen.findByRole("button", { name: "Salvar como recorrente" }));
    return screen.findByRole("dialog", { name: "Salvar como recorrente" });
  };
  const saved = (name = "Reposição mensal") => ({ status: 201, body: orderTemplateDetail({ name }) });

  it("is disabled without a customer or without lines, and enabled with a valid line", async () => {
    const { user } = renderApp("/pedidos/novo", { handlers: editorHandlers() });
    expect(await screen.findByRole("button", { name: "Salvar como recorrente" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^Cliente/ }));
    await user.click(await screen.findByRole("button", { name: /Comercial Alfa/ }));
    expect(screen.getByRole("button", { name: "Salvar como recorrente" })).toBeDisabled();
    await addProduct(user, "Balão");
    expect(screen.getByRole("button", { name: "Salvar como recorrente" })).toBeEnabled();
    // An invalid quantity makes the current lines unfit to be saved.
    const quantity = screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    expect(screen.getByRole("button", { name: "Salvar como recorrente" })).toBeDisabled();
  });

  it("asks for a name and sends only name and product/quantity of the lines, with an idempotency key", async () => {
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: editorHandlers({ "POST /customers/:code/order-templates": saved() }),
    });
    await addProduct(user, "Balão");
    await addProduct(user, "Fita");
    const quantity = screen.getByLabelText("Quantidade de Fita de cetim azul");
    await user.clear(quantity);
    await user.type(quantity, "2,5");

    const dialog = await openSave(user);
    expect(within(dialog).getByRole("textbox", { name: /Nome do modelo/ })).toHaveFocus();
    // The name is required: nothing is sent without it.
    await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
    expect(await within(dialog).findByText("Informe o nome do modelo.")).toBeInTheDocument();
    expect(callsTo(calls, "POST", "/customers/1001/order-templates")).toHaveLength(0);

    await user.type(within(dialog).getByRole("textbox", { name: /Nome do modelo/ }), "  Reposição mensal ");
    await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/customers/1001/order-templates")).toHaveLength(1));
    const [request] = callsTo(calls, "POST", "/customers/1001/order-templates");
    const body = request?.body as { clientRequestId: string; name: string; items: unknown[] };
    expect(body.clientRequestId).toMatch(UUID);
    expect(body).toEqual({
      clientRequestId: body.clientRequestId,
      name: "Reposição mensal",
      items: [
        { productCode: 2001, quantity: "1" },
        { productCode: 2003, quantity: "2.5" },
      ],
    });
    expectNoMoneyKeys(body);
    expect(await screen.findByText("Modelo recorrente salvo")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Salvar como recorrente" })).not.toBeInTheDocument());
    // The order itself was not saved by this action.
    expect(callsTo(calls, "POST", "/orders")).toHaveLength(0);
  });

  it("keeps the same request id on a retry of the same payload and a new one when the name changes", async () => {
    let attempt = 0;
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: editorHandlers({
        "POST /customers/:code/order-templates": () => {
          attempt += 1;
          return attempt === 1 ? apiError(503, "service_unavailable", "x") : saved();
        },
      }),
    });
    await addProduct(user, "Balão");
    const dialog = await openSave(user);
    await user.type(within(dialog).getByRole("textbox", { name: /Nome do modelo/ }), "Reposição mensal");
    await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
    expect(await within(dialog).findByText("Serviço indisponível")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/customers/1001/order-templates")).toHaveLength(2));
    const [first, second] = callsTo(calls, "POST", "/customers/1001/order-templates");
    expect((first?.body as { clientRequestId: string }).clientRequestId).toBe(
      (second?.body as { clientRequestId: string }).clientRequestId,
    );
  });

  it("shows a duplicate name on the field, lets the seller fix it and does not reuse the key for another payload", async () => {
    let attempt = 0;
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: editorHandlers({
        "POST /customers/:code/order-templates": () => {
          attempt += 1;
          return attempt === 1 ? apiError(409, "conflict", "x", { details: { reason: "template_name_taken" } }) : saved("Outro nome");
        },
      }),
    });
    await addProduct(user, "Balão");
    const dialog = await openSave(user);
    const name = within(dialog).getByRole("textbox", { name: /Nome do modelo/ });
    await user.type(name, "Reposição mensal");
    await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
    expect(await within(dialog).findByText("Já existe um modelo com este nome para este cliente. Escolha outro nome.")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");

    await user.clear(name);
    await user.type(name, "Outro nome");
    await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/customers/1001/order-templates")).toHaveLength(2));
    const [first, second] = callsTo(calls, "POST", "/customers/1001/order-templates");
    expect((first?.body as { clientRequestId: string }).clientRequestId).not.toBe(
      (second?.body as { clientRequestId: string }).clientRequestId,
    );
    expect(await screen.findByText("Modelo recorrente salvo")).toBeInTheDocument();
  });

  it("explains the per-customer limit and keeps the dialog open", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: editorHandlers({
        "POST /customers/:code/order-templates": apiError(409, "conflict", "x", {
          details: { reason: "template_limit_reached", limit: 50 },
        }),
      }),
    });
    await addProduct(user, "Balão");
    const dialog = await openSave(user);
    await user.type(within(dialog).getByRole("textbox", { name: /Nome do modelo/ }), "Mais um");
    await user.click(within(dialog).getByRole("button", { name: "Salvar modelo" }));
    expect(await within(dialog).findByText("Limite de modelos atingido")).toBeInTheDocument();
    expect(within(dialog).getByText(/máximo de modelos recorrentes \(50\)\. Apague um modelo/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Salvar como recorrente" })).toBeInTheDocument();
  });

  it("does not submit the order form when the dialog is submitted (Enter in the name field)", async () => {
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: editorHandlers({ "POST /customers/:code/order-templates": saved() }),
    });
    await addProduct(user, "Balão");
    const dialog = await openSave(user);
    await user.type(within(dialog).getByRole("textbox", { name: /Nome do modelo/ }), "Reposição mensal{Enter}");
    await waitFor(() => expect(callsTo(calls, "POST", "/customers/1001/order-templates")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/orders")).toHaveLength(0);
  });
});
