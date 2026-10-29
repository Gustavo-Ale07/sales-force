import { expect, test } from "@playwright/test";
import { SELLER_CUSTOMER, bodyRows, loginAsSeller, navLink, sellerFilter, tableRegion } from "./support/app";

// Fixture facts (synthetic fake Sankhya data, mirrored by `sync:once`): demo seller 103 has 31 customers.
const SELLER_103_CUSTOMERS = 31;
const SELLER_NAME = "Beatriz Casterino";

test.describe("Cenário 2 — carteira do vendedor", () => {
  test("lista somente os clientes do vendedor, em duas páginas, e nenhum de outro vendedor", async ({ page }) => {
    await loginAsSeller(page);
    const sellersLoaded = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/sellers");
    await navLink(page, "Clientes").click();
    await expect(page.getByRole("heading", { level: 1, name: "Carteira de clientes" })).toBeVisible();

    const clientes = tableRegion(page, "Clientes");
    await expect(page.getByText(`Mostrando 1–25 de ${SELLER_103_CUSTOMERS}`)).toBeVisible();
    const firstPage = bodyRows(clientes);
    await expect(firstPage).toHaveCount(25);
    // Every visible row belongs to the seller's own portfolio.
    for (const row of await firstPage.all()) await expect(row).toContainText(SELLER_NAME);

    await page.getByRole("button", { name: "Página 2" }).click();
    await expect(page.getByText(`Mostrando 26–${SELLER_103_CUSTOMERS} de ${SELLER_103_CUSTOMERS}`)).toBeVisible();
    const secondPage = bodyRows(clientes);
    await expect(secondPage).toHaveCount(SELLER_103_CUSTOMERS - 25);
    for (const row of await secondPage.all()) await expect(row).toContainText(SELLER_NAME);

    // A seller with a single seller code gets no "Vendedor" filter to widen the scope (checked after the sellers list arrived).
    expect((await sellersLoaded).status()).toBe(200);
    await expect(sellerFilter(page)).toHaveCount(0);
  });

  test("a busca filtra por nome, mostra o estado vazio e limpa os filtros", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Clientes").click();

    const search = page.getByRole("searchbox", { name: "Buscar cliente por código, nome ou documento" });
    await search.fill("Alvaro");
    await expect(page).toHaveURL(/search=Alvaro/);
    const clientes = tableRegion(page, "Clientes");
    await expect(bodyRows(clientes)).toHaveCount(1);
    await expect(bodyRows(clientes).first()).toContainText(SELLER_CUSTOMER.name);

    await search.fill("zzz-nenhum-cliente");
    await expect(page.getByText("Nenhum cliente encontrado")).toBeVisible();

    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page.getByText(`Mostrando 1–25 de ${SELLER_103_CUSTOMERS}`)).toBeVisible();
  });

  test("abre o detalhe de um cliente pela linha, pelo teclado, e volta pela navegação", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Clientes").click();
    await page.getByRole("searchbox", { name: "Buscar cliente por código, nome ou documento" }).fill("Alvaro");

    const row = bodyRows(tableRegion(page, "Clientes")).first();
    await expect(row).toContainText(SELLER_CUSTOMER.name);
    await row.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(new RegExp(`/clientes/${SELLER_CUSTOMER.code}$`));
    await expect(page.getByRole("heading", { level: 1, name: SELLER_CUSTOMER.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cadastro" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Condições comerciais" })).toBeVisible();
    await expect(page.getByText("Código", { exact: true })).toBeVisible();
    await expect(page.getByText(String(SELLER_CUSTOMER.code), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(SELLER_NAME).first()).toBeVisible();
    await expect(page.getByText(/^21 — /)).toBeVisible();
    await expect(page.getByText(/Tabela 21 \(do cliente\)/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pedidos do cliente" })).toBeVisible();
    // Breadcrumbs reflect the location.
    await expect(page.getByRole("navigation", { name: "Trilha de navegação" })).toContainText(`Cliente ${SELLER_CUSTOMER.code}`);

    // The order shortcut carries the customer into the editor.
    await page.getByRole("link", { name: "Novo pedido" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Novo pedido" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /^Cliente/ })).toHaveValue(`${SELLER_CUSTOMER.code} — ${SELLER_CUSTOMER.name}`);
  });
});
