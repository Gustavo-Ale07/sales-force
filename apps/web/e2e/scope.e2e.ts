import { expect, test } from "@playwright/test";
import { E2E_WEB_ORIGIN } from "./support/env";
import { OTHER_SELLER_CUSTOMER, bodyRows, createDraftViaUi, loginAsManager, loginAsSeller, loginAsSeller2, navLink, sellerFilter, tableRegion } from "./support/app";

// Fixture facts (synthetic fake Sankhya data): 250 mirrored customers; manager scope is "all sellers".
const ALL_CUSTOMERS = 250;
const SELLER_103_CUSTOMERS = 31;
const ALVARO = "Alvaro Hortelini";
const OTHER_SELLER = { code: 104, name: "Caetano Belfrago", customers: 19 } as const;

/** Removes per-request identifiers so two error bodies can be compared. */
function withoutCorrelation(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(withoutCorrelation);
  if (body !== null && typeof body === "object") {
    return Object.fromEntries(
      Object.entries(body)
        .filter(([key]) => !/correlation|request/i.test(key))
        .map(([key, value]) => [key, withoutCorrelation(value)]),
    );
  }
  return body;
}

test.describe("Cenário 6 — escopo de carteira (vendedor x gerente)", () => {
  test("o gerente enxerga toda a base e pode filtrar por vendedor; o vendedor enxerga menos", async ({ page }) => {
    await loginAsManager(page);
    await expect(page.getByText("Escopo: Todos os vendedores")).toBeVisible();

    const sellersLoaded = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/sellers");
    await navLink(page, "Clientes").click();
    expect((await sellersLoaded).status()).toBe(200);
    await expect(page.getByText(`Mostrando 1–25 de ${ALL_CUSTOMERS}`)).toBeVisible();
    await expect(sellerFilter(page)).toBeVisible();

    await sellerFilter(page).selectOption({ label: OTHER_SELLER.name });
    await expect(page.getByText(`Mostrando 1–${OTHER_SELLER.customers} de ${OTHER_SELLER.customers}`)).toBeVisible();
    const rows = bodyRows(tableRegion(page, "Clientes"));
    await expect(rows).toHaveCount(OTHER_SELLER.customers);
    for (const row of await rows.all()) await expect(row).toContainText(OTHER_SELLER.name);
  });

  test("o vendedor vê apenas a própria carteira, menos que o gerente", async ({ page }) => {
    await loginAsSeller(page);
    await expect(page.getByText("Escopo: Vendedor 103")).toBeVisible();
    await navLink(page, "Clientes").click();
    await expect(page.getByText(`Mostrando 1–25 de ${SELLER_103_CUSTOMERS}`)).toBeVisible();
    expect(SELLER_103_CUSTOMERS).toBeLessThan(ALL_CUSTOMERS);
  });

  test("o vendedor não abre cliente de outro vendedor pela URL e nada do cliente vaza", async ({ page }) => {
    await loginAsSeller(page);
    await page.goto(`/clientes/${OTHER_SELLER_CUSTOMER.code}`);

    await expect(page.getByText("Não encontrado", { exact: true })).toBeVisible();
    await expect(page.getByText("O registro não existe ou está fora da sua carteira.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(OTHER_SELLER_CUSTOMER.name);
    await expect(page.getByRole("heading", { level: 1, name: OTHER_SELLER_CUSTOMER.name })).toHaveCount(0);
  });

  test("a API responde igual para cliente de outro vendedor e cliente inexistente (sem oráculo de existência)", async ({ page }) => {
    await loginAsSeller(page);
    const foreign = await page.request.get(`/api/v1/customers/${OTHER_SELLER_CUSTOMER.code}`);
    const missing = await page.request.get("/api/v1/customers/99999999");
    expect(foreign.status()).toBe(404);
    expect(missing.status()).toBe(404);
    const foreignBody = (await foreign.json()) as unknown;
    expect(JSON.stringify(foreignBody)).not.toContain(OTHER_SELLER_CUSTOMER.name);
    expect(withoutCorrelation(foreignBody)).toEqual(withoutCorrelation((await missing.json()) as unknown));

    // Forcing the scope through a query parameter does not widen it either.
    const widened = await page.request.get(`/api/v1/customers?sellerCode=${OTHER_SELLER.code}&pageSize=100`);
    expect(widened.status()).toBe(200);
    const body = (await widened.json()) as { total: number; items: unknown[] };
    expect(body.total).toBe(0);
    expect(body.items).toHaveLength(0);
  });

  test("filtrar por outro vendedor na URL mostra o estado vazio, não a carteira dele", async ({ page }) => {
    await loginAsSeller(page);
    await page.goto(`/clientes?sellerCode=${OTHER_SELLER.code}`);
    await expect(page.getByText("Nenhum cliente encontrado")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(OTHER_SELLER.name);
  });

  test("um vendedor não lê, altera, envia nem descarta o rascunho de outro vendedor", async ({ page, browser }) => {
    await loginAsSeller(page);
    const { id } = await createDraftViaUi(page);

    const otherContext = await browser.newContext({ baseURL: E2E_WEB_ORIGIN, locale: "pt-BR" });
    try {
      const other = await otherContext.newPage();
      await loginAsSeller2(other);
      // Same-origin requests as the SPA would send them (the API checks the Origin of unsafe methods).
      const headers = { Origin: E2E_WEB_ORIGIN };
      expect((await other.request.get(`/api/v1/orders/${id}`)).status()).toBe(404);
      expect((await other.request.delete(`/api/v1/orders/${id}`, { headers })).status()).toBe(404);
      expect((await other.request.post(`/api/v1/orders/${id}/submit`, { headers })).status()).toBe(404);

      await other.goto(`/pedidos/${id}`);
      await expect(other.getByText("Não encontrado", { exact: true })).toBeVisible();
      await expect(other.locator("body")).not.toContainText(ALVARO);

      const list = (await (await other.request.get("/api/v1/orders?pageSize=100")).json()) as { items: Array<{ id: string }> };
      expect(list.items.map((o) => o.id)).not.toContain(id);
    } finally {
      await otherContext.close();
    }

    // The owner's draft is untouched by the attempts above.
    const stored = await page.request.get(`/api/v1/orders/${id}`);
    expect(stored.status()).toBe(200);
    expect(((await stored.json()) as { status: string }).status).toBe("draft");
  });
});
