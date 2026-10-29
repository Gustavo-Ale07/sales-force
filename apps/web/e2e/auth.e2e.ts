import { expect, test } from "@playwright/test";
import { ACCOUNTS, demoPassword } from "./support/env";
import { loginAsSeller, statTile } from "./support/app";

test.describe("Cenário 1 — entrada, resumo e saída", () => {
  test("o vendedor entra e o início mostra os indicadores da carteira dele", async ({ page }) => {
    await page.goto("/");
    // Anonymous visitor is sent to the login form and the original target is remembered.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
    await expect(page.getByTestId("dev-auth-banner")).toContainText("autenticação de desenvolvimento");

    await loginAsSeller(page);

    await expect(page.getByText("Escopo: Vendedor 103")).toBeVisible();
    const portfolio = page.getByLabel("Carteira de clientes", { exact: true });
    await expect(portfolio).toBeVisible();
    await expect(statTile(page, "Clientes na carteira")).toContainText("31");
    await expect(statTile(page, "Clientes ativos e liberados")).toBeVisible();
    await expect(statTile(page, "Rascunhos em aberto")).toBeVisible();
    await expect(page.getByLabel("Catálogo", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Novo pedido" })).toBeVisible();
  });

  test("senha incorreta mostra um erro acionável, sem dizer qual dado falhou, e devolve o foco à senha", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(ACCOUNTS.seller);
    await page.getByLabel(/^Senha/).fill(`${demoPassword()}-errada`);
    await page.getByRole("button", { name: "Entrar" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("E-mail ou senha incorretos.");
    await expect(page).toHaveURL(/\/login/);
    // The password is cleared and the keyboard user lands back in it.
    await expect(page.getByLabel(/^Senha/)).toHaveValue("");
    await expect(page.getByLabel(/^Senha/)).toBeFocused();
    // Nothing of the application is reachable.
    await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(0);
  });

  test("campos vazios são validados no cliente com mensagens em português", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Informe o e-mail.")).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeFocused();
    await expect(page.getByLabel("E-mail")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("E-mail").fill("sem-arroba");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText(/Informe um e-mail válido/)).toBeVisible();
  });

  test("sair encerra a sessão no servidor e bloqueia o acesso às telas e à API", async ({ page }) => {
    await loginAsSeller(page);
    expect((await page.request.get("/api/v1/customers?pageSize=1")).status()).toBe(200);

    await page.getByRole("button", { name: `Menu do usuário ${ACCOUNTS.sellerName}` }).click();
    await page.getByRole("menuitem", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();

    // The cookie is no longer a valid session: the API refuses it and a protected route redirects to the login.
    expect((await page.request.get("/api/v1/customers?pageSize=1")).status()).toBe(401);
    await page.goto("/clientes");
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
  });
});
