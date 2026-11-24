import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customer, customersPage } from "../test/fixtures";
import { callsTo, renderApp } from "../test/harness";

const handlers = {
  "GET /customers": { body: customersPage([customer()]) },
  "GET /customers/letters": { body: { letters: [{ letter: "A", count: 3 }, { letter: "C", count: 12 }, { letter: "#", count: 1 }] } },
};

describe("Clientes: índice A-Z", () => {
  it("shows the letters with data, filters by the chosen one (URL + API) and clears it", async () => {
    const { user, calls, router } = renderApp("/clientes", { handlers });
    const nav = await screen.findByRole("navigation", { name: "Índice alfabético" });
    expect(nav).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clientes com B/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clientes com C: 12" }));
    await waitFor(() => expect(callsTo(calls, "GET", "/customers").at(-1)?.search.get("initial")).toBe("C"));
    expect(router.state.location.search).toMatchObject({ initial: "C" });
    await user.click(screen.getByRole("button", { name: "Remover filtro: Letra: C" }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("initial"));
  });

  it("an invalid initial in the URL is ignored", async () => {
    const { calls } = renderApp("/clientes?initial=zz", { handlers });
    await screen.findByRole("navigation", { name: "Índice alfabético" });
    expect(callsTo(calls, "GET", "/customers").at(-1)?.search.has("initial")).toBe(false);
  });
});
