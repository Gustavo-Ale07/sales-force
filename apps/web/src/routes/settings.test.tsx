import type { ApiSchema } from "@salesforce/contracts/client";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { configuration, customersPage, customerDetail, dashboard, ordersPage } from "../test/fixtures";
import { callsTo, renderApp } from "../test/harness";

const shellData = {
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
};

const READ_AT = "2026-11-03T12:00:00.000Z";
const sankhyaSnapshot: ApiSchema<"ConfigurationResponse"> = {
  ...configuration,
  gateway: { mode: "live" },
  configuration: {
    ...configuration.configuration,
    source: { kind: "sankhya", version: "sankhya-2026-11-03", syncedAt: READ_AT, base: { kind: "bootstrap-file", version: "plac-staging-2026-11-03" } },
    sales: {
      ...configuration.configuration.sales,
      eligibleOrderTopCodes: [1001, 1000],
      topAllowlist: [1000, 1001],
      quoteTopCodes: [1000],
      skipConfirmationTopCodes: [],
    },
    customers: { ...configuration.configuration.customers, historyDays: 30 },
    erp: { liberationEventLabels: { "44": "liberação exigida pela TOP" } },
    provenance: {
      "customers.historyDays": { table: "AD_TVDYCFGFRC", column: "DIASCONSULTAVENDAS", readAt: READ_AT },
      "sales.quoteTopCodes": { table: "TGFTOP", column: "AD_MOBILIDADE", filter: "TIPMOV = 'P'", readAt: READ_AT },
      "sales.topAllowlist": { source: "base" },
    },
  },
  syncStates: [
    { entity: "configuration", status: "succeeded", lastSuccessAt: READ_AT, lastAttemptAt: READ_AT, lastFullReconcileAt: READ_AT, rowCount: null, lastErrorClass: null, lastErrorMessage: null },
  ],
};

const rowOf = (label: string) => screen.getByText(label).closest("tr") as HTMLElement;

describe("W-38 settings (read-only)", () => {
  it("sends a seller or manager back to the start page without asking for the configuration", async () => {
    for (const role of ["seller", "manager"] as const) {
      const { router, calls, unmount } = renderApp("/configuracoes", { handlers: shellData, role });
      await waitFor(() => expect(router.state.location.pathname).toBe("/"));
      expect(callsTo(calls, "GET", "/configuration")).toHaveLength(0);
      unmount();
    }
  });

  it("shows each value with its origin, the banner and the sync state for a sankhya snapshot", async () => {
    renderApp("/configuracoes", { handlers: { "GET /configuration": { body: sankhyaSnapshot } }, role: "admin" });
    expect(await screen.findByText(/Edite no Sankhya; o Force lê a cada 15 min/)).toBeInTheDocument();
    expect(screen.getByText("Concluída")).toBeInTheDocument();
    for (const group of ["Geral", "Vendas", "Clientes", "Produtos", "Preços", "Financeiro", "Sankhya"]) {
      expect(screen.getAllByText(group).length).toBeGreaterThan(0);
    }
    expect(within(rowOf("Dias de histórico de vendas")).getByText("Sankhya: AD_TVDYCFGFRC.DIASCONSULTAVENDAS")).toBeInTheDocument();
    expect(within(rowOf("Dias de histórico de vendas")).getByText("30")).toBeInTheDocument();
    expect(within(rowOf("TOPs de orçamento")).getByText("Sankhya: TGFTOP.AD_MOBILIDADE")).toBeInTheDocument();
    expect(within(rowOf("Lista de TOPs autorizadas")).getByText("arquivo base")).toBeInTheDocument();
    expect(within(rowOf("TOPs sem confirmação")).getByText("Nenhum")).toBeInTheDocument();
    expect(within(rowOf("Eventos de liberação")).getByText("44 liberação exigida pela TOP")).toBeInTheDocument();
  });

  it("has no editing control", async () => {
    renderApp("/configuracoes", { handlers: { "GET /configuration": { body: sankhyaSnapshot } }, role: "admin" });
    await screen.findByText("Edite no Sankhya");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /salvar/i })).not.toBeInTheDocument();
  });

  it("shows the sync as off and every value from the base file for a bootstrap-file snapshot", async () => {
    const base: ApiSchema<"ConfigurationResponse"> = {
      ...configuration,
      syncStates: [],
      configuration: { ...configuration.configuration, source: { kind: "bootstrap-file", version: "plac-staging-2026-11-03", syncedAt: READ_AT } },
    };
    renderApp("/configuracoes", { handlers: { "GET /configuration": { body: base } }, role: "technical" });
    expect(await screen.findByText("Desligada")).toBeInTheDocument();
    expect(screen.getByText(/os valores vêm do arquivo base/)).toBeInTheDocument();
    expect(within(rowOf("Pedidos habilitados")).getByText("arquivo base")).toBeInTheDocument();
    expect(screen.queryByText(/^Sankhya: /)).not.toBeInTheDocument();
  });

  it("shows the reason when the last sync failed", async () => {
    const failed: ApiSchema<"ConfigurationResponse"> = {
      ...sankhyaSnapshot,
      syncStates: [{ entity: "configuration", status: "failed", lastSuccessAt: null, lastAttemptAt: READ_AT, lastFullReconcileAt: null, rowCount: null, lastErrorClass: "auth", lastErrorMessage: "token rejeitado" }],
    };
    renderApp("/configuracoes", { handlers: { "GET /configuration": { body: failed } }, role: "admin" });
    expect(await screen.findByText("Falhou")).toBeInTheDocument();
    expect(screen.getByText(/token rejeitado/)).toBeInTheDocument();
  });
});
