import { expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, demoPassword } from "./env";
import { openSellerSession } from "./session";

/** Name of the session cookie (`SESSION_COOKIE_NAME` in `@salesforce/contracts`; the suite does not import the application). */
const SESSION_COOKIE_NAME = "sf_session";

/** Signs in through the real login form (username + local password: only roles that have one, i.e. not sellers) and waits for the dashboard. */
export async function loginAs(page: Page, username: string, name: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuário").fill(username);
  await page.getByLabel(/^Senha/).fill(demoPassword());
  await page.getByRole("button", { name: "Entrar" }).click();
  await expectSignedIn(page, name);
}

/**
 * Opens a seller session with the session fixture (AUTH-6 option c, TEST-1): sellers never have a local password and the
 * Sankhya verifier is not part of the throwaway stack (AUTH-5: no fake verifier). See `session.ts`.
 */
export async function loginWithSessionFixture(page: Page, username: string, directoryUserId: string, name: string): Promise<void> {
  const token = openSellerSession(username, directoryUserId);
  await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: token, domain: "127.0.0.1", path: "/api/v1", httpOnly: true, sameSite: "Lax", secure: false }]);
  await page.goto("/");
  await expectSignedIn(page, name);
}

async function expectSignedIn(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("button", { name: `Menu do usuário ${name}` })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
}

export function loginAsSeller(page: Page): Promise<void> {
  return loginWithSessionFixture(page, ACCOUNTS.seller, "910001", ACCOUNTS.sellerName);
}

export function loginAsSeller2(page: Page): Promise<void> {
  return loginWithSessionFixture(page, ACCOUNTS.seller2, "910002", ACCOUNTS.seller2Name);
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
  return page.getByRole("main").getByText(label, { exact: true }).locator("xpath=..");
}

/** The "Preço" select of the catalog filters (a select's label also contains its options, so it is found by its options). */
export function priceStateFilter(page: Page): Locator {
  return page.getByRole("combobox").filter({ has: page.getByRole("option", { name: "Preço zero" }) });
}

/** The "Vendedor" filter select of the customer list (only rendered when the actor can see more than one seller). */
export function sellerFilter(page: Page): Locator {
  return page.locator("label").filter({ has: page.getByText("Vendedor", { exact: true }) }).getByRole("combobox");
}

/** Picks a customer in the "Selecionar cliente" dialog of the order editor (search, then the result card). */
export async function pickCustomer(page: Page, search: string, customerName: string, trigger: Locator = page.getByRole("button", { name: /^Cliente/ })): Promise<void> {
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Selecionar cliente" });
  await dialog.getByRole("searchbox", { name: "Cliente" }).fill(search);
  await dialog.getByRole("button", { name: new RegExp(customerName, "i") }).first().click();
  await expect(dialog).toBeHidden();
}

/** Adds a product from the "Produtos" view of the order editor with the given quantity text. */
export async function addProduct(page: Page, description: string, quantityText: string): Promise<void> {
  await page.getByRole("searchbox", { name: "Buscar produto" }).fill(description);
  const quantity = page.getByRole("textbox", { name: `Quantidade de ${description} a adicionar` }).first();
  await quantity.fill(quantityText);
  await page.getByRole("button", { name: `Adicionar ${description}` }).first().click();
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
  await navLink(page, "Vendas").click();
  await page.getByRole("link", { name: "Novo pedido" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Novo pedido" })).toBeVisible();

  await pickCustomer(page, "Alvaro", SELLER_CUSTOMER.name);
  await addProduct(page, PRICED_PRODUCTS[0], "2");
  await addProduct(page, PRICED_PRODUCTS[1], "3,5");
  await page.getByRole("button", { name: /^Carrinho/ }).click();

  const total = (await page.getByTestId("order-total").innerText()).trim();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Rascunho", { exact: true }).first()).toBeVisible();
  const id = page.url().split("/").pop() ?? "";
  return { id, total };
}
