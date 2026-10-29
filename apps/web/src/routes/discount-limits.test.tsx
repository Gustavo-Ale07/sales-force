import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customersPage, customerDetail, dashboard, ordersPage } from "../test/fixtures";
import { apiError, callsTo, renderApp } from "../test/harness";

const shellData = {
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
};
const stored = (provisional: boolean) => ({
  limits: { seller: "5", manager: "15", director: "30" },
  provisional,
  revision: "sha256:one",
  updatedAt: "2026-10-29T10:00:00.000Z",
});

describe("W-39 discount limits", () => {
  it("sends a seller or manager back to the start page without asking for the limits", async () => {
    for (const role of ["seller", "manager"] as const) {
      const { router, calls, unmount } = renderApp("/limites-desconto", { handlers: shellData, role });
      await waitFor(() => expect(router.state.location.pathname).toBe("/"));
      expect(callsTo(calls, "GET", "/discount-limits")).toHaveLength(0);
      unmount();
    }
  });

  it("shows the provisional notice and the three limits to the admin", async () => {
    renderApp("/limites-desconto", { handlers: { ...shellData, "GET /discount-limits": { body: stored(true) } }, role: "admin" });
    expect(await screen.findByText("Valores provisórios")).toBeInTheDocument();
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue("5");
    expect(screen.getByLabelText(/Gerente/)).toHaveValue("15");
    expect(screen.getByLabelText(/Diretoria/)).toHaveValue("30");
  });

  it("blocks descending values on the client without sending anything", async () => {
    const { user, calls } = renderApp("/limites-desconto", { handlers: { ...shellData, "GET /discount-limits": { body: stored(false) } }, role: "admin" });
    const seller = await screen.findByLabelText(/Vendedor/);
    await user.clear(seller);
    await user.type(seller, "20");
    await user.click(screen.getByRole("button", { name: "Salvar limites" }));
    expect(await screen.findByText("O limite do gerente não pode ser menor que o do vendedor.")).toBeInTheDocument();
    expect(callsTo(calls, "PUT", "/discount-limits")).toHaveLength(0);
  });

  it("saves with the loaded revision, accepting the comma, and confirms", async () => {
    const { user, calls } = renderApp("/limites-desconto", {
      handlers: {
        ...shellData,
        "GET /discount-limits": { body: stored(true) },
        "PUT /discount-limits": { body: { ...stored(false), limits: { seller: "4.5", manager: "12", director: "25" }, revision: "sha256:two" } },
      },
      role: "admin",
    });
    const seller = await screen.findByLabelText(/Vendedor/);
    await user.clear(seller);
    await user.type(seller, "4,5");
    const manager = screen.getByLabelText(/Gerente/);
    await user.clear(manager);
    await user.type(manager, "12");
    const director = screen.getByLabelText(/Diretoria/);
    await user.clear(director);
    await user.type(director, "25");
    await user.click(screen.getByRole("button", { name: "Salvar limites" }));
    expect(await screen.findByText("Limites de desconto salvos")).toBeInTheDocument();
    expect(callsTo(calls, "PUT", "/discount-limits")[0]?.body).toEqual({
      expectedRevision: "sha256:one",
      limits: { seller: "4.5", manager: "12", director: "25" },
    });
  });

  it("explains a version conflict and offers to reload", async () => {
    const { user } = renderApp("/limites-desconto", {
      handlers: {
        ...shellData,
        "GET /discount-limits": { body: stored(false) },
        "PUT /discount-limits": apiError(409, "version_conflict", "A versão mudou."),
      },
      role: "admin",
    });
    await screen.findByLabelText(/Vendedor/);
    await user.click(screen.getByRole("button", { name: "Salvar limites" }));
    expect(await screen.findByText("Os limites foram alterados por outra pessoa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
  });
});
