import { screen } from "@testing-library/react";
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

afterEach(() => vi.restoreAllMocks());

describe("/downloads (public)", () => {
  it("opens without a session and lists the published build with its digest and a same-origin link", async () => {
    stubIndex(() => new Response(JSON.stringify({ items: [item] }), { status: 200 }));
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Force (Android)" })).toBeInTheDocument();
    expect(screen.getByText("Versão atual")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Baixar para Android/ });
    expect(link).toHaveAttribute("href", "/downloads-files/force-staging-12.apk");
    expect(screen.getByText("b".repeat(64))).toBeInTheDocument();
  });

  it("shows an empty state when nothing is published", async () => {
    stubIndex(() => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByText("Nenhuma versão publicada")).toBeInTheDocument();
  });

  it("shows an error state with retry when the index cannot be loaded", async () => {
    stubIndex(() => new Response("", { status: 500 }));
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByText("Não foi possível carregar a lista de downloads")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentar de novo/ })).toBeInTheDocument();
  });

  it("ignores a tampered entry instead of rendering it", async () => {
    stubIndex(() => new Response(JSON.stringify({ items: [{ ...item, file: "../../etc/passwd.apk" }] }), { status: 200 }));
    renderApp("/downloads", { signedIn: false });
    expect(await screen.findByText("Nenhuma versão publicada")).toBeInTheDocument();
  });
});
