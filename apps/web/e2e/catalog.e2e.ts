import { expect, test } from "@playwright/test";
import { PRICED_PRODUCTS, SELLER_CUSTOMER, UNPRICED_PRODUCT, bodyRows, loginAsSeller, navLink, pickFromCombobox, priceStateFilter, tableRegion } from "./support/app";

/** Cost, margin and markup vocabulary that must never reach an external-facing catalog view (P-20/P-23). */
const RESTRICTED_TEXT = /\b(custos?|margem|margens|markup|lucro|cost|costs|margin|margins|profit)\b/i;

const RESTRICTED_KEY = /cost|margin|markup|profit|margem|lucro|custo(?!mer)/i;

/** Every property name that appears anywhere in a JSON document. */
function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
  }
  return [];
}

test.describe("Cenário 3 — catálogo, preços e dados restritos", () => {
  test("produto sem linha de preço mostra 'Sem preço', nunca R$ 0,00, e nenhum custo/margem aparece", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Produtos").click();
    await expect(page.getByRole("heading", { level: 1, name: "Catálogo de produtos" })).toBeVisible();

    await page.getByRole("searchbox", { name: "Buscar produto por código, descrição ou referência" }).fill("Aguarrás");
    const produtos = tableRegion(page, "Produtos");
    const unpriced = bodyRows(produtos).filter({ hasText: UNPRICED_PRODUCT });
    await expect(unpriced).toHaveCount(1);
    await expect(unpriced).toContainText("Sem preço");
    await expect(unpriced).not.toContainText("R$");

    await expect(page.locator("body")).not.toContainText(RESTRICTED_TEXT);
    await expect(page.getByRole("columnheader", { name: /custo|margem/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /exportar|baixar|download/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /exportar|baixar|download/i })).toHaveCount(0);
  });

  test("o filtro 'Sem preço' lista somente linhas sem valor monetário", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Produtos").click();
    await priceStateFilter(page).selectOption({ label: "Sem preço" });
    await expect(page).toHaveURL(/priceState=none/);

    const rows = bodyRows(tableRegion(page, "Produtos"));
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText(/Mostrando 1–25 de \d/)).toBeVisible();
    for (const row of await rows.all()) {
      await expect(row).toContainText("Sem preço");
      await expect(row).not.toContainText("R$");
    }
  });

  test("com um cliente escolhido, a origem da tabela aparece e produtos com preço mostram valor em reais", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Produtos").click();
    await pickFromCombobox(page, page.getByRole("combobox", { name: "Preços para o cliente" }), "Alvaro", new RegExp(`^${SELLER_CUSTOMER.code} — `));
    await expect(page).toHaveURL(new RegExp(`customerCode=${SELLER_CUSTOMER.code}`));
    await expect(page.getByText(`Cliente: ${SELLER_CUSTOMER.name}`)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /Origem dos preços.*Preços da tabela 21/ })).toBeVisible();

    await page.getByRole("searchbox", { name: "Buscar produto por código, descrição ou referência" }).fill(PRICED_PRODUCTS[0]);
    const priced = bodyRows(tableRegion(page, "Produtos")).filter({ hasText: PRICED_PRODUCTS[0] }).first();
    await expect(priced).toContainText(/R\$\s?\d{1,3}(\.\d{3})*,\d{2}/);
    await expect(priced).not.toContainText("Sem preço");
  });

  test("o painel do produto mostra a origem do preço e o estado vazio da busca é claro", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Produtos").click();
    const search = page.getByRole("searchbox", { name: "Buscar produto por código, descrição ou referência" });

    await search.fill("zzz-nenhum-produto");
    await expect(page.getByText("Nenhum produto encontrado")).toBeVisible();

    await search.fill(UNPRICED_PRODUCT);
    const row = bodyRows(tableRegion(page, "Produtos")).filter({ hasText: UNPRICED_PRODUCT }).first();
    await row.click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Preço de lista")).toBeVisible();
    await expect(panel.getByText("Sem preço")).toBeVisible();
    await expect(panel.getByText("Origem do preço", { exact: true })).toBeVisible();
    await expect(panel).not.toContainText(RESTRICTED_TEXT);
    await expect(panel).not.toContainText("R$");

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("a API do catálogo não envia campos de custo ou margem ao vendedor", async ({ page }) => {
    await loginAsSeller(page);
    const response = await page.request.get(`/api/v1/products?customerCode=${SELLER_CUSTOMER.code}&pageSize=100`);
    expect(response.status()).toBe(200);
    const raw = await response.text();
    // Property names, not values: a surname such as "Costa" is legitimate data.
    expect(collectKeys(JSON.parse(raw) as unknown).filter((key) => RESTRICTED_KEY.test(key))).toEqual([]);
    const first = (JSON.parse(raw) as { items: Array<Record<string, unknown>> }).items[0];
    expect(first).toBeDefined();
    expect(Object.keys(first ?? {}).sort()).toEqual(
      ["active", "brand", "code", "description", "groupCode", "groupName", "listPrice", "reference", "sellable", "unit"].sort(),
    );
  });
});
