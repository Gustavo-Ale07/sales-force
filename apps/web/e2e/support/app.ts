import { expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, demoPassword } from "./env";

/** Signs in through the real login form (no shortcuts) and waits for the dashboard. */
export async function loginAs(page: Page, email: string, name: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel(/^Senha/).fill(demoPassword());
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("button", { name: `Menu do usuário ${name}` })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
}

export function loginAsSeller(page: Page): Promise<void> {
  return loginAs(page, ACCOUNTS.seller, ACCOUNTS.sellerName);
}

export function loginAsSeller2(page: Page): Promise<void> {
  return loginAs(page, ACCOUNTS.seller2, ACCOUNTS.seller2Name);
}

export function loginAsManager(page: Page): Promise<void> {
  return loginAs(page, ACCOUNTS.manager, ACCOUNTS.managerName);
}

/** Main navigation link (sidebar). */
export function navLink(page: Page, name: string): Locator {
  return page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name });
}

/** Data table by its accessible region name. */
export function tableRegion(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/** Rows of a table region without the header row. */
export function bodyRows(region: Locator): Locator {
  return region.getByRole("row").filter({ hasNot: region.page().getByRole("columnheader") });
}

/** Dashboard tile by its label (label and value live in the same tile element). */
export function statTile(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator("xpath=..");
}

/** The "Preço" select of the catalog filters (a select's label also contains its options, so it is found by its options). */
export function priceStateFilter(page: Page): Locator {
  return page.getByRole("combobox").filter({ has: page.getByRole("option", { name: "Preço zero" }) });
}

/** The "Vendedor" filter select of the customer list (only rendered when the actor can see more than one seller). */
export function sellerFilter(page: Page): Locator {
  return page.locator("label").filter({ has: page.getByText("Vendedor", { exact: true }) }).getByRole("combobox");
}

/** Picks an option of a search-as-you-type combobox (customer / product pickers). */
export async function pickFromCombobox(page: Page, combobox: Locator, search: string, optionName: string | RegExp): Promise<void> {
  await combobox.click();
  await combobox.fill(search);
  await page.getByRole("option", { name: optionName }).first().click();
}

/** The customer used by the order scenarios: a synthetic customer of demo seller 103 (fake Sankhya fixture). */
export const SELLER_CUSTOMER = { code: 40156, name: "Alvaro Hortelini" } as const;

/** A customer of another seller (104): outside the demo seller's scope. */
export const OTHER_SELLER_CUSTOMER = { code: 40357, name: "Cadrena Caldeiraria ME" } as const;

/** Products of the fake catalog: priced in the customer's table, and sellable but without a price row. */
export const PRICED_PRODUCTS = ["Aguarrás branco", "Alicate universal 13 mm"] as const;
export const UNPRICED_PRODUCT = "Aguarrás 0,9 L";

/**
 * Creates a draft for the seller's customer with the two priced products through the UI and leaves the browser on
 * the saved draft. Returns the total shown in the editor and the draft's id.
 */
export async function createDraftViaUi(page: Page): Promise<{ id: string; total: string }> {
  await navLink(page, "Pedidos").click();
  await page.getByRole("link", { name: "Novo pedido" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Novo pedido" })).toBeVisible();

  await pickFromCombobox(page, page.getByRole("combobox", { name: /^Cliente/ }), "Alvaro", new RegExp(`^${SELLER_CUSTOMER.code} — ${SELLER_CUSTOMER.name}`));
  for (const product of PRICED_PRODUCTS) {
    await pickFromCombobox(page, page.getByRole("combobox", { name: "Adicionar produto" }), product, new RegExp(`— ${product}`));
    await expect(page.getByRole("textbox", { name: `Quantidade de ${product}` })).toBeVisible();
  }
  await page.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[0]}` }).fill("2");
  await page.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[1]}` }).fill("3,5");

  const total = (await page.getByTestId("order-total").innerText()).trim();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Rascunho", { exact: true }).first()).toBeVisible();
  const id = page.url().split("/").pop() ?? "";
  return { id, total };
}
