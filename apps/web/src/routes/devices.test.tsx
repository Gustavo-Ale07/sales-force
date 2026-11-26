import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customersPage, customerDetail, dashboard, ordersPage } from "../test/fixtures";
import { callsTo, renderApp } from "../test/harness";

const shellData = {
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
};
const pending = {
  id: "d1",
  accountId: "a1",
  accountName: "Maria Souza",
  accountUsername: "maria",
  label: "Galaxy A54",
  platform: "android",
  status: "pending",
  createdAt: "2026-11-20T10:00:00.000Z",
  lastSeenAt: "2026-11-25T10:00:00.000Z",
  lastSyncAt: null,
  decidedAt: null,
  decidedByName: null,
  canManage: true,
};

describe("W-36 devices", () => {
  it("sends a seller back to the start page without asking for devices", async () => {
    const { router, calls } = renderApp("/aparelhos", { handlers: shellData, role: "seller" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(callsTo(calls, "GET", "/devices")).toHaveLength(0);
  });

  it("lists the devices and approves a pending one", async () => {
    const { user, calls } = renderApp("/aparelhos", {
      handlers: {
        ...shellData,
        "GET /devices": { body: { items: [pending] } },
        "POST /devices/:id/approve": { body: { ...pending, status: "approved" } },
      },
      role: "manager",
    });
    expect(await screen.findByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByText("Aguardando aprovação")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/devices/d1/approve")).toHaveLength(1));
  });

  it("offers no action on a device the caller cannot manage", async () => {
    renderApp("/aparelhos", {
      handlers: { ...shellData, "GET /devices": { body: { items: [{ ...pending, canManage: false }] } } },
      role: "manager",
    });
    expect(await screen.findByText("Maria Souza")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revogar" })).toBeNull();
  });
});
