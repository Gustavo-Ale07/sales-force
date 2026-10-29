import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS } from "./support/env";
import { loginAsSeller, navLink } from "./support/app";

/*
 * Accessibility smoke through role-based assertions (WCAG 2.1 AA, frontend rules). This does not replace an automated
 * rule engine or a manual review: colour contrast, zoom/reflow and screen-reader output are NOT covered here.
 * An engine such as axe-core was deliberately not added: it is a new dependency for a smoke check the roles below
 * already cover for the structure that matters in Phase 0; add it when contrast/ARIA-validity checks are wanted.
 */

const APP_PAGES = [
  { link: "Início", heading: "Início", title: "Início" },
  { link: "Clientes", heading: "Clientes", title: "Clientes" },
  { link: "Catálogo", heading: "Catálogo de produtos", title: "Produtos" },
  { link: "Vendas", heading: "Vendas", title: "Pedidos" },
] as const;

/** Visible interactive controls that expose no accessible name (approximation of the accessible-name algorithm). */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=combobox], [role=menuitem], [role=tab]";
    const isVisible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (id: string) => document.getElementById(id)?.textContent?.trim() ?? "";
    const problems: string[] = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!isVisible(el) && !el.classList.contains("sr-only")) continue;
      const labelledBy = el.getAttribute("aria-labelledby");
      const label =
        el.getAttribute("aria-label")?.trim() ||
        (labelledBy ? labelledBy.split(/\s+/).map(textOf).join(" ").trim() : "") ||
        (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
        el.getAttribute("title")?.trim() ||
        el.textContent?.trim() ||
        el.querySelector("img[alt]")?.getAttribute("alt")?.trim() ||
        "";
      if (label === "") problems.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.getAttribute("type") ? `[type=${el.getAttribute("type")}]` : ""}`);
    }
    return problems;
  });
}

test.describe("Acessibilidade — verificação por papéis (smoke)", () => {
  test("a tela de entrada tem título, um h1, campos rotulados e nenhum controle sem nome", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/\S/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByLabel("Usuário")).toBeVisible();
    await expect(page.getByLabel(/^Senha/)).toBeVisible();
    await expect(page.getByLabel(/^Senha/)).toHaveAttribute("type", "password");
    expect(await unnamedControls(page)).toEqual([]);
  });

  test("cada tela principal tem landmarks, um único h1, título distinto e controles nomeados", async ({ page }) => {
    await loginAsSeller(page);
    const titles = new Set<string>();
    for (const { link, heading, title } of APP_PAGES) {
      await navLink(page, link).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(1);
      await expect(navLink(page, link)).toHaveAttribute("aria-current", "page");
      await expect(page).toHaveTitle(new RegExp(`^${title}\\s+—\\s+\\S`));
      titles.add(await page.title());
      expect(await unnamedControls(page), `controles sem nome em "${link}"`).toEqual([]);
    }
    expect(titles.size).toBe(APP_PAGES.length);
  });

  test("o editor de pedido tem formulário nomeado, campos rotulados e controles nomeados", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Vendas").click();
    await page.getByRole("link", { name: "Novo pedido" }).first().click();
    await expect(page.getByRole("form", { name: "Pedido" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cliente/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Carrinho/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await unnamedControls(page)).toEqual([]);
  });

  test("o teclado alcança o link de salto primeiro e ele leva o foco ao conteúdo", async ({ page }) => {
    await loginAsSeller(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Ir para o conteúdo" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("ao navegar dentro do aplicativo o foco vai para o conteúdo da nova página", async ({ page }) => {
    await loginAsSeller(page);
    await navLink(page, "Clientes").click();
    await expect(page.getByRole("heading", { level: 1, name: "Clientes" })).toBeVisible();
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("o menu do usuário abre pelo teclado, fecha com Escape e devolve o foco ao botão", async ({ page }) => {
    await loginAsSeller(page);
    const trigger = page.getByRole("button", { name: `Menu do usuário ${ACCOUNTS.sellerName}` });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Sair" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Sair" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("o erro de formulário fica ligado ao campo: aria-invalid e aria-describedby apontam para a mensagem", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByLabel("Usuário")).toHaveAttribute("aria-invalid", "true");
    const describedBy = await page.getByLabel("Usuário").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy?.split(" ")[0] ?? "x"}`)).toContainText("Informe o usuário.");
  });
});
