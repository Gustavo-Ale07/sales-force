import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../test/harness";

const item = {
  id: "android-staging",
  platform: "android",
  channel: "staging",
  label: "Force (Android)",
  versionName: "0.1.0",
  versionCode: 12,
  minVersionCode: 10,
  file: "force-staging-12.apk",
  sha256: "b".repeat(64),
  sizeBytes: 52_428_800,
  publishedAt: "2026-11-11T12:00:00Z",
};

function stubIndex(response: () => Response) {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).includes("/downloads-files/downloads.json")) return response();
    return new Response("{}", { status: 404 });
  });
  return spy;
}

const published = (...items: unknown[]) => stubIndex(() => new Response(JSON.stringify({ items }), { status: 200 }));

afterEach(() => vi.restoreAllMocks());

describe("/downloads (public)", () => {
  it("opens without a session and offers the published build as a same-origin link, with details collapsed under 'Detalhes da versão'", async () => {
    published(item);
    renderApp("/downloads", { signedIn: false });
    const link = await screen.findByRole("link", { name: /Baixar para Android/ });
    expect(link).toHaveAttribute("href", "/downloads-files/force-staging-12.apk");
    expect(screen.getByRole("heading", { level: 1, name: /Baixe o Force onde você estiver/i })).toBeInTheDocument();
    const details = screen.getByText("Detalhes da versão").closest("details");
    expect(details).not.toBeNull();
    const scope = within(details as HTMLElement);
    expect(scope.getByText("0.1.0 (12)")).toBeInTheDocument();
    expect(scope.getByText("50,0 MB")).toBeInTheDocument();
    expect(scope.getByText("b".repeat(64))).toBeInTheDocument();
    expect(scope.getByText("11/11/2026")).toBeInTheDocument();
  });

  it("keeps the page and disables the Android action when nothing is published", async () => {
    published();
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByText("Nenhuma versão disponível ainda. Volte em breve.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Android - em breve" })).toBeDisabled();
    expect(screen.queryByText("Detalhes da versão")).not.toBeInTheDocument();
  });

  it("treats a missing downloads.json (404) as empty: install steps visible, disabled CTA, no error", async () => {
    stubIndex(() => new Response("", { status: 404 }));
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByText("Nenhuma versão disponível ainda. Volte em breve.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Android - em breve" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Como instalar" })).toBeInTheDocument();
    expect(screen.getByText(/Abra esta página no celular/)).toBeInTheDocument();
    expect(screen.queryByText("Não foi possível carregar a lista de downloads.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tentar de novo/ })).not.toBeInTheDocument();
  });

  it("shows a discreet error for invalid JSON", async () => {
    stubIndex(() => new Response("<html>not json", { status: 200 }));
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByText(/Não foi possível carregar a lista de downloads/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Android - em breve" })).toBeDisabled();
  });

  it("shows a discreet error with retry when the index cannot be loaded, and retries", async () => {
    let calls = 0;
    stubIndex(() => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 500 }) : new Response(JSON.stringify({ items: [item] }), { status: 200 });
    });
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByText(/Não foi possível carregar a lista de downloads/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(await screen.findByRole("link", { name: /Baixar para Android/ })).toHaveAttribute("href", "/downloads-files/force-staging-12.apk");
  });

  it("ignores a tampered entry instead of rendering it", async () => {
    published({ ...item, file: "../../etc/passwd.apk" });
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByText("Nenhuma versão disponível ainda. Volte em breve.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Baixar para Android/ })).not.toBeInTheDocument();
  });

  it("shows the 'Versão de testes' notice when the newest build is on the staging channel", async () => {
    published(item);
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Versão de testes" })).toBeInTheDocument();
    expect(screen.getByText(/os pedidos feitos aqui não são lançados de verdade/)).toBeInTheDocument();
  });

  it("does not show the test notice for a production build", async () => {
    published({ ...item, channel: "production" });
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByRole("link", { name: /Baixar para Android/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Versão de testes" })).not.toBeInTheDocument();
  });

  it("links to the login and the browser app, and keeps store buttons disabled", async () => {
    published();
    renderApp("/downloads", { signedIn: false });
    await screen.findByText("Nenhuma versão disponível ainda. Volte em breve.");
    expect(screen.getAllByRole("link", { name: "Entrar" })[0]).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Abrir o Force no navegador" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "App Store - em breve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Google Play - em breve" })).toBeDisabled();
    expect(screen.getByText("O app é seguro?")).toBeInTheDocument();
  });
});
