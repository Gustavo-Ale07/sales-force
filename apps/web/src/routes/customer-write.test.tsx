import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customer, customerDetail, customersPage, orderEntryConfiguration } from "../test/fixtures";
import { apiError, callsTo, renderApp, type Handlers } from "../test/harness";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const configWith = (general: Record<string, boolean>) => ({
  body: { ...orderEntryConfiguration, general: { ...orderEntryConfiguration.general, ...general } },
});

const detailHandlers = (general: Record<string, boolean>, extra: Handlers = {}): Handlers => ({
  "GET /order-entry/configuration": configWith(general),
  "GET /customers/:code": { body: customerDetail({ code: 1001 }) },
  ...extra,
});

const updated = { updateId: "0190a000-0000-7000-8000-000000000001", customerCode: 1001, state: "awaiting_send", reasonCode: null, reasonMessage: null, updatedAt: "2026-11-25T12:00:00.000Z" };

describe("Ficha do cliente: edição (D-AP)", () => {
  it("has no edit button while the installation has not released the edit", async () => {
    renderApp("/clientes/1001", { handlers: detailHandlers({ clientEditEnabled: false }) });
    await screen.findByRole("link", { name: /Novo pedido/ });
    expect(screen.queryByRole("button", { name: "Editar cliente" })).not.toBeInTheDocument();
  });

  it("has no edit button when the flag is absent (older server)", async () => {
    renderApp("/clientes/1001", { handlers: detailHandlers({}) });
    await screen.findByRole("link", { name: /Novo pedido/ });
    expect(screen.queryByRole("button", { name: "Editar cliente" })).not.toBeInTheDocument();
  });

  it("sends the strict PATCH body with only what was filled in", async () => {
    const { user, calls } = renderApp("/clientes/1001", {
      handlers: detailHandlers({ clientEditEnabled: true }, { "PATCH /customers/:code": { status: 202, body: updated } }),
    });
    await user.click(await screen.findByRole("button", { name: "Editar cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Telefone"), "(11) 98888-7777");
    await user.type(within(dialog).getByLabelText("E-mail"), "compras@alfa.com.br");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(callsTo(calls, "PATCH", "/customers/1001")).toHaveLength(1));
    const body = callsTo(calls, "PATCH", "/customers/1001")[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["clientRequestId", "email", "phone"]);
    expect(body.clientRequestId).toMatch(UUID);
    expect(body.phone).toBe("11988887777");
    expect(body.email).toBe("compras@alfa.com.br");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Aguardando envio ao Sankhya")).toBeInTheDocument();
  });

  it("sends contacts as a list with name, role, phone and e-mail", async () => {
    const { user, calls } = renderApp("/clientes/1001", {
      handlers: detailHandlers({ clientEditEnabled: true }, { "PATCH /customers/:code": { status: 202, body: updated } }),
    });
    await user.click(await screen.findByRole("button", { name: "Editar cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Adicionar contato" }));
    await user.type(within(dialog).getByLabelText(/Nome do contato/), "Ana Souza");
    await user.type(within(dialog).getByLabelText("Cargo"), "Compras");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(callsTo(calls, "PATCH", "/customers/1001")).toHaveLength(1));
    expect(callsTo(calls, "PATCH", "/customers/1001")[0]?.body).toMatchObject({ contacts: [{ name: "Ana Souza", role: "Compras", phone: null, email: null }] });
  });

  it("does not send an empty form and shows what is missing", async () => {
    const { user, calls } = renderApp("/clientes/1001", { handlers: detailHandlers({ clientEditEnabled: true }) });
    await user.click(await screen.findByRole("button", { name: "Editar cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("Preencha ao menos um campo para alterar.")).toBeInTheDocument();
    expect(callsTo(calls, "PATCH", "/customers/1001")).toHaveLength(0);
  });

  it("shows a 409 refusal as actionable text, inside the form, without a native alert", async () => {
    const { user } = renderApp("/clientes/1001", {
      handlers: detailHandlers(
        { clientEditEnabled: true },
        { "PATCH /customers/:code": apiError(409, "conflict", "Edição indisponível", { details: { reason: "customer_edit_delivery_not_approved" }, requestId: "req-1" }) },
      ),
    });
    await user.click(await screen.findByRole("button", { name: "Editar cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Telefone"), "1133334444");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/ainda não pode ser enviada ao Sankhya/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("names the refused fields of a 400", async () => {
    const { user } = renderApp("/clientes/1001", {
      handlers: detailHandlers(
        { clientEditEnabled: true },
        { "PATCH /customers/:code": apiError(400, "validation_failed", "Dados inválidos", { issues: [{ path: "document", code: "unrecognized_keys", message: "x" }] }) },
      ),
    });
    await user.click(await screen.findByRole("button", { name: "Editar cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Telefone"), "1133334444");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("Estes campos não podem ser alterados: CPF/CNPJ.")).toBeInTheDocument();
  });

  it("shows the ERP refusal text when the state is Precisa de correção", async () => {
    const { user } = renderApp("/clientes/1001", {
      handlers: detailHandlers(
        { clientEditEnabled: true },
        { "PATCH /customers/:code": { status: 202, body: { ...updated, state: "needs_correction", reasonCode: "erp_refused", reasonMessage: "O Sankhya recusou o telefone informado." } } },
      ),
    });
    await user.click(await screen.findByRole("button", { name: "Editar cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Telefone"), "1133334444");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("O Sankhya recusou o telefone informado.")).toBeInTheDocument();
    expect(within(dialog).getByText("Precisa de correção")).toBeInTheDocument();
  });
});

describe("Clientes: cadastro (D-AR)", () => {
  const list: Handlers = { "GET /customers": { body: customersPage([customer()]) }, "GET /customers/letters": { body: { letters: [] } } };

  it("has no new-customer button unless creation is released", async () => {
    renderApp("/clientes", { handlers: { ...list, "GET /order-entry/configuration": configWith({ clientCreationEnabled: false }) } });
    await screen.findByText("Comercial Alfa Ltda");
    expect(screen.queryByRole("button", { name: "Novo cliente" })).not.toBeInTheDocument();
  });

  it("refuses an invalid CNPJ before sending", async () => {
    const { user, calls } = renderApp("/clientes", { handlers: { ...list, "GET /order-entry/configuration": configWith({ clientCreationEnabled: true }) } });
    await user.click(await screen.findByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/CPF\/CNPJ/), "11222333000100");
    await user.type(within(dialog).getByLabelText(/Razão social/), "Alfa Ltda");
    await user.click(within(dialog).getByRole("button", { name: "Cadastrar" }));
    expect(await within(dialog).findByText("CPF ou CNPJ inválido.")).toBeInTheDocument();
    expect(callsTo(calls, "POST", "/customers")).toHaveLength(0);
  });

  it("creates with the shared field names, ICMS R by default and Isento", async () => {
    const { user, calls } = renderApp("/clientes", {
      handlers: {
        ...list,
        "GET /order-entry/configuration": configWith({ clientCreationEnabled: true }),
        "POST /customers": { status: 202, body: { registrationId: "0190a000-0000-7000-8000-000000000002", status: "pending", customerCode: null, originKey: "force:x" } },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/CPF\/CNPJ/), "11.222.333/0001-81");
    await user.type(within(dialog).getByLabelText(/Razão social/), "Alfa Ltda");
    await user.click(within(dialog).getByRole("checkbox", { name: "Isento" }));
    await user.click(within(dialog).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/customers")).toHaveLength(1));
    const body = callsTo(calls, "POST", "/customers")[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ document: "11222333000181", name: "Alfa Ltda", tradeName: null, icmsClassification: "R", stateRegistration: "ISENTO", phone: null, email: null, notes: null, addresses: [] });
    expect(body.clientRequestId).toMatch(UUID);
    expect(await screen.findByText("Aguardando envio ao Sankhya")).toBeInTheDocument();
  });

  it("shows the duplicate document refusal", async () => {
    const { user } = renderApp("/clientes", {
      handlers: {
        ...list,
        "GET /order-entry/configuration": configWith({ clientCreationEnabled: true }),
        "POST /customers": apiError(409, "conflict", "dup", { details: { reason: "document_already_registered" } }),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/CPF\/CNPJ/), "11222333000181");
    await user.type(within(dialog).getByLabelText(/Razão social/), "Alfa Ltda");
    await user.click(within(dialog).getByRole("checkbox", { name: "Isento" }));
    await user.click(within(dialog).getByRole("button", { name: "Cadastrar" }));
    expect(await within(dialog).findByText("Já existe um cliente com este CPF/CNPJ.")).toBeInTheDocument();
  });
});
