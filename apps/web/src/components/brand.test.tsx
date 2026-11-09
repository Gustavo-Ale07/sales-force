import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppServicesProvider } from "../lib/app-context";
import { defaultRuntimeConfig, type RuntimeConfig } from "../lib/runtime-config";
import { Brand } from "./brand";

function renderBrand(config: Partial<RuntimeConfig>) {
  return render(
    <AppServicesProvider value={{ config: { ...defaultRuntimeConfig, installationName: "Acme", ...config }, authClient: {} as never, api: {} as never }}>
      <Brand />
    </AppServicesProvider>,
  );
}

describe("Brand", () => {
  it("falls back to the mark, then to the placeholder and name, when an image fails to load", () => {
    const { container } = renderBrand({ brand: { logoUrl: "/brand/logo.svg", markUrl: "/brand/mark.png", accent: null } });
    fireEvent.error(screen.getByRole("img", { name: "Acme" }));
    expect(screen.getByText("Acme")).toBeInTheDocument();
    const mark = container.querySelector('img[src="/brand/mark.png"]');
    expect(mark).not.toBeNull();
    fireEvent.error(mark!);
    // The configured mark failed: the product's round P stands in before the initial does.
    const fallback = container.querySelector('img[src="/brand/icon-p.png"]');
    expect(fallback).not.toBeNull();
    fireEvent.error(fallback!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("shows the product's round P (icon-p.png) and the installation name when the installation defines no mark", () => {
    const { container } = renderBrand({});
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(container.querySelector('img[src="/brand/icon-p.png"]')).not.toBeNull();
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });

  it("falls back to the initial only when even the default P cannot be loaded", () => {
    const { container } = renderBrand({});
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("the header shows the P and the bare name \"Force\"", () => {
    const { container } = renderBrand({ installationName: "Force" });
    expect(container.querySelector('img[src="/brand/icon-p.png"]')).not.toBeNull();
    expect(screen.getByText("Force")).toBeInTheDocument();
    expect(screen.queryByText(/PLAC/)).not.toBeInTheDocument();
  });

  it("shows the configured logo with the installation name as its accessible name, without repeating the name", () => {
    renderBrand({ brand: { logoUrl: "/brand/logo.svg", markUrl: null, accent: null } });
    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute("src", "/brand/logo.svg");
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });

  it("shows the mark next to the name when there is no logo", () => {
    const { container } = renderBrand({ brand: { logoUrl: null, markUrl: "/brand/mark.png", accent: null } });
    expect(container.querySelector('img[src="/brand/mark.png"]')).not.toBeNull();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("SF")).not.toBeInTheDocument();
  });
});
