import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { noPriceList, product, productsPage } from "../test/fixtures";
import { callsTo, renderApp } from "../test/harness";

const groups = { "GET /product-groups": { body: { items: [{ code: 30, name: "Balões", parentCode: null, degree: 1, hasChildren: false }], hierarchical: true, hasUngrouped: false } } };

describe("Catálogo: modo grade de fotos", () => {
  it("starts as a table and toggles to a photo grid with the same data, no cost or margin", async () => {
    const image = { version: "h1", thumbnailUrl: "/api/v1/products/2001/image?variant=thumb", url: "/api/v1/products/2001/image?variant=full" };
    const { user } = renderApp("/produtos", {
      handlers: { ...groups, "GET /products": { body: productsPage([product({ image }), product({ code: 2002, description: "Vela lisa", listPrice: noPriceList("no_price_row") })]) } },
    });
    await screen.findByText("Balão látex 9 pol. vermelho");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Produtos em grade" })).toBeNull();

    await user.click(screen.getByRole("radio", { name: /Grade/ }));

    const grid = screen.getByRole("list", { name: "Produtos em grade" });
    expect(screen.queryByRole("table")).toBeNull();
    expect(within(grid).getAllByRole("listitem")).toHaveLength(2);
    expect(grid.querySelector("img")).toHaveAttribute("src", "/api/v1/products/2001/image?variant=thumb&v=h1");
    expect(grid.querySelector("img")).toHaveAttribute("alt", "");
    expect(within(grid).getAllByText("Balão látex 9 pol. vermelho")).toHaveLength(1);
    expect(within(grid).queryByText("Vendável")).toBeNull();
    expect(within(grid).getByText("Sem preço")).toBeInTheDocument();
    expect(document.querySelectorAll('img[src*="variant=full"]')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/custo|margem|cost|margin/i);

    await user.click(screen.getByRole("radio", { name: /Lista/ }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("lists only sellable products and offers no Venda filter", async () => {
    const { calls } = renderApp("/produtos", { handlers: { ...groups, "GET /products": { body: productsPage([product()]) } } });
    await screen.findByText("Balão látex 9 pol. vermelho");
    expect(callsTo(calls, "GET", "/products").every((call) => call.search.get("sellable") === "true")).toBe(true);
    expect(screen.queryByRole("combobox", { name: "Venda" })).toBeNull();
    expect(screen.queryByText("Não vendáveis")).toBeNull();
  });

  it("opens the detail panel from a grid card", async () => {
    const { user } = renderApp("/produtos", { handlers: { ...groups, "GET /products": { body: productsPage([product()]) } } });
    await screen.findByText("Balão látex 9 pol. vermelho");
    await user.click(screen.getByRole("radio", { name: /Grade/ }));
    await user.click(within(screen.getByRole("list", { name: "Produtos em grade" })).getByRole("button", { name: /Balão látex/ }));
    expect(await screen.findByText("Detalhes do produto e origem do preço")).toBeInTheDocument();
  });

  it("keeps the empty state in grid mode", async () => {
    const { user } = renderApp("/produtos", { handlers: { ...groups, "GET /products": { body: productsPage([]) } } });
    await screen.findByText("Nenhum produto disponível");
    await user.click(screen.getByRole("radio", { name: /Grade/ }));
    expect(screen.getByText("Nenhum produto disponível")).toBeInTheDocument();
  });
});
