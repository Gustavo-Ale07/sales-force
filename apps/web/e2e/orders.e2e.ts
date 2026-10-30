import { expect, test, type Page } from "@playwright/test";
import { PRICED_PRODUCTS, SELLER_CUSTOMER, UNPRICED_PRODUCT, bodyRows, createDraftViaUi, loginAsSeller, navLink, pickCustomer, addProduct, tableRegion } from "./support/app";

/** The draft's reference ("Rascunho nº 12") as shown in the editor title. */
async function draftReference(page: Page): Promise<string> {
  // The status badge sits inside the h1, so the accessible name is "Rascunho nº 12 Rascunho".
  const heading = page.getByRole("heading", { level: 1, name: /^Rascunho nº \d+/ });
  await expect(heading).toBeVisible();
  const match = /^Rascunho nº \d+/.exec((await heading.innerText()).trim());
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("Cenário 4 — novo pedido, rascunhos e descarte", () => {
  test("cria um rascunho com dois produtos, confere o total e o encontra em Pedidos", async ({ page }) => {
    await loginAsSeller(page);
    const { total } = await createDraftViaUi(page);
    expect(total).toMatch(/^R\$\s?\d{1,3}(\.\d{3})*,\d{2}$/);
    const reference = await draftReference(page);

    await navLink(page, "Vendas").click();
    const row = bodyRows(tableRegion(page, "Pedidos")).filter({ hasText: reference });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Rascunho");
    await expect(row).toContainText(SELLER_CUSTOMER.name);
    await expect(row).toContainText(total);
    await expect(row.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  });

  test("reabre o rascunho, altera a quantidade, salva e o valor persiste após recarregar a página", async ({ page }) => {
    await loginAsSeller(page);
    const { id, total } = await createDraftViaUi(page);
    const reference = await draftReference(page);

    await navLink(page, "Vendas").click();
    await bodyRows(tableRegion(page, "Pedidos")).filter({ hasText: reference }).click();
    await expect(page).toHaveURL(new RegExp(`/pedidos/${id}$`));
    await expect(page.getByRole("button", { name: /^Cliente/ })).toContainText(`${SELLER_CUSTOMER.code} — `);
    const first = page.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[0]}` });
    await expect(first).toHaveValue("2");
    await expect(page.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[1]}` })).toHaveValue("3,5");
    // Nothing changed yet: no needless save, no send while unsaved changes exist.
    const save = page.getByRole("button", { name: "Salvar rascunho" });
    await expect(save).toBeDisabled();

    await first.fill("7");
    await expect(save).toBeEnabled();
    await expect(page.getByRole("button", { name: "Enviar ao Sankhya" })).toBeDisabled();
    await expect(page.getByTestId("order-total")).not.toHaveText(total);
    const newTotal = (await page.getByTestId("order-total").innerText()).trim();

    // Wait for the server's answer itself: the toast of the first save may still be on screen, and reloading while the
    // request is in flight would abort it.
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/v1/orders/${id}`) && r.request().method() === "PUT");
    await save.click();
    expect((await saved).status()).toBe(200);
    await expect(save).toBeDisabled();

    await page.reload();
    await expect(page.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[0]}` })).toHaveValue("7");
    await expect(page.getByTestId("order-total")).toHaveText(newTotal);
  });

  test("quantidade inválida é sinalizada e impede o salvamento", async ({ page }) => {
    await loginAsSeller(page);
    await createDraftViaUi(page);
    const first = page.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[0]}` });
    await first.fill("0");
    await expect(first).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
    await first.fill("abc");
    await expect(first).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  test("linha sem preço aparece como 'Sem preço' (nunca R$ 0,00), o total é parcial e a remoção o normaliza", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Vendas").click();
    await page.getByRole("link", { name: "Novo pedido" }).first().click();
    await pickCustomer(page, "Alvaro", SELLER_CUSTOMER.name);
    await addProduct(page, PRICED_PRODUCTS[0], "1");
    await addProduct(page, UNPRICED_PRODUCT, "1");
    await page.getByRole("button", { name: /^Carrinho/ }).click();

    const unpricedRow = bodyRows(tableRegion(page, "Itens do pedido")).filter({ hasText: UNPRICED_PRODUCT });
    await expect(unpricedRow).toContainText("Sem preço");
    await expect(unpricedRow).not.toContainText("R$");
    await expect(page.getByText("Total parcial estimado")).toBeVisible();
    await expect(page.getByText("1 item sem preço não entra na soma.")).toBeVisible();

    // The editor itself blocks saving a line that is not orderable in this installation (demo configuration), with a
    // message the seller can act on; nothing is sent and nothing is created. The server still refuses it (API tests).
    await expect(page.getByText("Este item não pode ser pedido sem preço nesta instalação.")).toBeVisible();
    await expect(page.getByText("Remova os itens sem preço para salvar.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
    await expect(page).toHaveURL(/\/pedidos\/novo$/);

    await page.getByRole("button", { name: `Remover ${UNPRICED_PRODUCT}` }).click();
    await expect(page.getByLabel("Resumo do pedido").getByRole("term").filter({ hasText: "Total" })).toHaveText("Total estimado");
    await expect(page.getByText("Total parcial estimado")).toHaveCount(0);
    await expect(page.getByTestId("order-total")).toContainText(/R\$\s?\d/);
  });

  test("sair com alterações não salvas pede confirmação e permite continuar editando", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Vendas").click();
    await page.getByRole("link", { name: "Novo pedido" }).first().click();
    await pickCustomer(page, "Alvaro", SELLER_CUSTOMER.name);
    await addProduct(page, PRICED_PRODUCTS[0], "1");

    await navLink(page, "Clientes").click();
    const dialog = page.getByRole("dialog", { name: "Sair sem salvar?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continuar editando" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Novo pedido" })).toBeVisible();

    await navLink(page, "Clientes").click();
    await page.getByRole("dialog", { name: "Sair sem salvar?" }).getByRole("button", { name: "Sair sem salvar" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Clientes" })).toBeVisible();
  });

  test("descartar pede confirmação; 'Manter rascunho' preserva e a confirmação marca como Descartado", async ({ page }) => {
    await loginAsSeller(page);
    await createDraftViaUi(page);
    const reference = await draftReference(page);

    await navLink(page, "Vendas").click();
    const row = bodyRows(tableRegion(page, "Pedidos")).filter({ hasText: reference });
    await row.getByRole("button", { name: `Descartar ${reference}` }).click();
    const dialog = page.getByRole("dialog", { name: "Descartar rascunho?" });
    await expect(dialog).toContainText(reference);
    await dialog.getByRole("button", { name: "Manter rascunho" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("Rascunho");

    await row.getByRole("button", { name: `Descartar ${reference}` }).click();
    await page.getByRole("dialog", { name: "Descartar rascunho?" }).getByRole("button", { name: "Descartar", exact: true }).click();
    await expect(row).toContainText("Descartado");
    // A discarded draft is no longer editable and offers no further discard action.
    await expect(row.getByRole("button", { name: /^Descartar/ })).toHaveCount(0);
    await row.click();
    await expect(page.getByText("Somente leitura")).toBeVisible();
    await expect(page.getByRole("button", { name: "Salvar rascunho" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enviar ao Sankhya" })).toHaveCount(0);
  });

  test("edição concorrente em outra aba gera conflito de versão com opção de recarregar", async ({ page, context }) => {
    await loginAsSeller(page);
    const { id } = await createDraftViaUi(page);

    const other = await context.newPage();
    await other.goto(`/pedidos/${id}`);
    const otherQty = other.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[0]}` });
    await expect(otherQty).toHaveValue("2");
    await otherQty.fill("9");
    const otherSaved = other.waitForResponse((r) => r.url().endsWith(`/api/v1/orders/${id}`) && r.request().method() === "PUT");
    await other.getByRole("button", { name: "Salvar rascunho" }).click();
    expect((await otherSaved).status()).toBe(200);

    // The first tab still holds the old version: its save must be refused, not silently overwrite.
    await page.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[0]}` }).fill("4");
    await page.getByRole("button", { name: "Salvar rascunho" }).click();
    const alert = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Recarregar" }) });
    await expect(alert).toBeVisible();

    const stored = await page.request.get(`/api/v1/orders/${id}`);
    expect(stored.status()).toBe(200);
    const body = (await stored.json()) as { items: Array<{ quantity: string }> };
    const quantities = body.items.map((item) => Number(item.quantity));
    expect(quantities).toContain(9);
    expect(quantities).not.toContain(4);

    await alert.getByRole("button", { name: "Recarregar" }).click();
    await expect(page.getByRole("textbox", { name: `Quantidade de ${PRICED_PRODUCTS[0]}` })).toHaveValue("9");
  });
});
