import type { ApiSchema } from "@salesforce/contracts/client";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customersPage, customerDetail, dashboard, orderDetail, ordersPage } from "../test/fixtures";
import { apiError, callsTo, renderApp } from "../test/harness";

const shellData = {
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
};

const item = (overrides: Partial<ApiSchema<"ApprovalQueueItem">> = {}): ApiSchema<"ApprovalQueueItem"> => ({
  approvalId: "0190a0c0-0000-7000-8000-0000000000a1",
  orderId: "0190a0c0-0000-7000-8000-0000000000b1",
  draftNumber: 12,
  customerCode: 1001,
  customerName: "COMERCIAL ALFA LTDA",
  sellerCode: 7,
  ownerName: "Vera Vendedora",
  requestedLevel: "manager",
  requestedAt: "2026-10-29T10:00:00.000Z",
  estimatedTotal: "250.00",
  itemCount: 2,
  maxDiscountPercent: "8.5",
  ...overrides,
});
const queue = (items: ApiSchema<"ApprovalQueueItem">[]) => ({ items, page: 1, pageSize: 25, total: items.length });

describe("W-20 approval queue", () => {
  it("keeps a seller out of the queue without asking for it", async () => {
    const { router, calls } = renderApp("/aprovacoes", { handlers: shellData, role: "seller" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(callsTo(calls, "GET", "/approvals")).toHaveLength(0);
  });

  it("lists the pending requests with who asked and the largest discount", async () => {
    renderApp("/aprovacoes", { handlers: { ...shellData, "GET /approvals": { body: queue([item(), item({ approvalId: "0190a0c0-0000-7000-8000-0000000000a2", draftNumber: 13, requestedLevel: "director" })]) } }, role: "manager" });
    expect(await screen.findByText("Rascunho nº 12")).toBeInTheDocument();
    expect(screen.getAllByText("Vera Vendedora")).toHaveLength(2);
    expect(screen.getAllByText("8,5%").length).toBeGreaterThan(0);
    expect(screen.getByText("Diretoria")).toBeInTheDocument();
  });

  it("shows an empty queue as such", async () => {
    renderApp("/aprovacoes", { handlers: { ...shellData, "GET /approvals": { body: queue([]) } }, role: "admin" });
    expect(await screen.findByText("Nenhuma aprovação pendente")).toBeInTheDocument();
  });

  it("approves with an optional comment through the explicit action", async () => {
    const { user, calls } = renderApp("/aprovacoes", {
      handlers: { ...shellData, "GET /approvals": { body: queue([item()]) }, "POST /approvals/:id/approve": { body: orderDetail({ status: "approved" }) } },
      role: "manager",
    });
    await user.click(await screen.findByRole("button", { name: "Aprovar rascunho nº 12" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Comentário/), "Cliente estratégico");
    await user.click(within(dialog).getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/approvals/0190a0c0-0000-7000-8000-0000000000a1/approve")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/approvals/0190a0c0-0000-7000-8000-0000000000a1/approve")[0]?.body).toEqual({ comment: "Cliente estratégico" });
  });

  it("refuses to reject without a comment, on the client, before any request", async () => {
    const { user, calls } = renderApp("/aprovacoes", { handlers: { ...shellData, "GET /approvals": { body: queue([item()]) } }, role: "manager" });
    await user.click(await screen.findByRole("button", { name: "Reprovar rascunho nº 12" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reprovar" }));
    expect(await within(dialog).findByText("Informe o motivo da reprovação.")).toBeInTheDocument();
    expect(callsTo(calls, "POST", "/approvals/0190a0c0-0000-7000-8000-0000000000a1/reject")).toHaveLength(0);
  });

  it("rejects with the mandatory comment and explains a request that is no longer pending", async () => {
    const { user, calls } = renderApp("/aprovacoes", {
      handlers: {
        ...shellData,
        "GET /approvals": { body: queue([item()]) },
        "POST /approvals/:id/reject": apiError(409, "approval_not_pending", "Esta solicitação já foi decidida ou cancelada.", { requestId: "req-ap-1" }),
      },
      role: "manager",
    });
    await user.click(await screen.findByRole("button", { name: "Reprovar rascunho nº 12" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Comentário/), "Desconto alto demais");
    await user.click(within(dialog).getByRole("button", { name: "Reprovar" }));
    expect(await within(dialog).findByText(/já foi decidida ou cancelada/)).toBeInTheDocument();
    expect(callsTo(calls, "POST", "/approvals/0190a0c0-0000-7000-8000-0000000000a1/reject")[0]?.body).toEqual({ comment: "Desconto alto demais" });
  });
});
