import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test/harness";
import { monthLabel } from "./metas";

const figure = (target: string | null, realized: string | null, percent: string | null) => ({ target, realized, percent });

const team = {
  month: "2026-11",
  goalsSyncedAt: "2026-11-26T10:00:00Z",
  salesSyncedAt: null,
  total: {
    revenue: figure("3000.00", "750.00", "25"),
    quantity: figure("50.000000", null, null),
    positivation: { positivated: 2, total: 3, percent: "66.7" },
  },
  bySeller: [
    { sellerCode: 10, sellerName: "Ana", revenue: figure("1000.00", "250.00", "25"), quantity: figure("50.000000", null, null), positivation: { positivated: 1, total: 2, percent: "50" } },
    { sellerCode: 20, sellerName: "Bruno", revenue: figure("2000.00", "500.00", "25"), quantity: figure(null, null, null), positivation: null },
  ],
};

describe("/metas (W-23)", () => {
  it("shows the month figures and the team table for a manager", async () => {
    renderApp("/metas", { role: "manager", handlers: { "GET /goals": { body: team } } });
    expect(await screen.findByText("novembro de 2026")).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Metas por vendedor" })).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    expect(screen.getByText(/2 de 3 \(66,7%\)/)).toBeInTheDocument();
  });

  it("shows no team table for a seller and never shows zero for what is unavailable", async () => {
    const own = { ...team, bySeller: [], total: { ...team.total, revenue: figure(null, null, null), positivation: null } };
    renderApp("/metas", { role: "seller", handlers: { "GET /goals": { body: own } } });
    expect(await screen.findByText("Sem meta no mês")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Metas por vendedor" })).not.toBeInTheDocument();
  });

  it("labels the month in pt-BR", () => {
    expect(monthLabel("2026-03")).toBe("março de 2026");
  });
});
