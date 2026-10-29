import { expect, test } from "@playwright/test";
import { bodyRows, createDraftViaUi, loginAsSeller, navLink, tableRegion } from "./support/app";

test.describe("Cenário 5 — envio ao ERP desabilitado", () => {
  test("'Enviar ao ERP' informa que o envio está desabilitado e o pedido continua rascunho", async ({ page }) => {
    await loginAsSeller(page);
    const { id } = await createDraftViaUi(page);

    const submitResponse = page.waitForResponse((r) => r.url().endsWith(`/api/v1/orders/${id}/submit`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Enviar ao ERP" }).click();
    const response = await submitResponse;

    // The server refuses: submission stays disabled until the write-safety gates close (SNK-4, roadmap).
    expect(response.status()).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("erp_submission_disabled");

    const alert = page.getByRole("alert").filter({ hasText: "Envio ao ERP indisponível" });
    await expect(alert).toBeVisible();
    // No success wording, and the order is still an editable draft.
    await expect(page.getByText(/enviado com sucesso|pedido enviado/i)).toHaveCount(0);
    await expect(page.getByText("Rascunho", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar ao ERP" })).toBeEnabled();

    // The authoritative check: nothing in the seller's orders left the draft state.
    const orders = await page.request.get("/api/v1/orders?pageSize=100");
    expect(orders.status()).toBe(200);
    const list = (await orders.json()) as { items: Array<{ id: string; status: string; erpNumber: number | null }> };
    expect(list.items.find((o) => o.id === id)?.status).toBe("draft");
    for (const order of list.items) {
      expect(["draft", "cancelled"]).toContain(order.status);
      expect(order.erpNumber).toBeNull();
    }
  });

  test("um segundo clique recebe a mesma recusa segura e nenhum pedido é criado no ERP", async ({ page }) => {
    await loginAsSeller(page);
    const { id } = await createDraftViaUi(page);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const submitResponse = page.waitForResponse((r) => r.url().endsWith(`/api/v1/orders/${id}/submit`));
      await page.getByRole("button", { name: "Enviar ao ERP" }).click();
      expect((await submitResponse).status()).toBe(409);
    }
    await navLink(page, "Pedidos").click();
    await expect(bodyRows(tableRegion(page, "Pedidos")).filter({ hasText: "Rascunho nº" }).first()).toBeVisible();
    await expect(bodyRows(tableRegion(page, "Pedidos")).filter({ hasText: /Na fila|Enviado|Rejeitado/ })).toHaveCount(0);
  });
});
