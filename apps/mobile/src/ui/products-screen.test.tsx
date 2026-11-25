import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import type { ProductGroupTree } from "../data/group-cascade";
import type { ProductListItem, ProductPageRequest, ProductRepository } from "../data/ports";
import { fakeProducts, networkError, pageOf, product } from "../test-doubles";
import { ProductBrowser } from "./product-browser";
import type { ProductOrderActions } from "./product-views";
import { ProductImageProvider } from "../images/product-image-context";
import type { ProductImageStore } from "../images/image-store";
import { ProductsScreen } from "./products-screen";

const noop = () => undefined;

// FlatList schedules an internal cell-range timer after each render; wait it out between tests (see
// new-order-screen.test.tsx for the full explanation).
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

const priced = (amount: string): ProductListItem["listPrice"] => ({ state: "priced", unitPrice: amount, tableCode: 1, versionId: 1 });

const CATALOG: readonly ProductListItem[] = [
  product(1, { description: "Tinta Azul 18L", groupCode: 10, groupName: "Tintas", listPrice: priced("120.5") }),
  product(2, { description: "Tinta Verde 3,6L", groupCode: 10, groupName: "Tintas", listPrice: priced("40") }),
  product(3, { description: "Solvente 5L", groupCode: 20, groupName: "Solventes" }),
  product(4, { description: "Pincel 2in", groupCode: 30, groupName: "Acessórios", listPrice: priced("9") }),
];

const node = (code: number, name: string, parentCode: number | null, hasChildren: boolean, subtreeCodes: number[]) => ({ code, name, parentCode, degree: 1, hasChildren, subtreeCodes });
/** Tintas > Esmaltes (no product of its own in the fixture); Solventes and Acessórios are final groups. */
const TREE: ProductGroupTree = {
  hierarchical: true,
  hasUngrouped: false,
  items: [node(30, "Acessórios", null, false, [30]), node(20, "Solventes", null, false, [20]), node(10, "Tintas", null, true, [10, 11]), node(11, "Esmaltes", 10, false, [11])],
};

/** A repository that filters like the offline cache does: search on description/code, groups, price state. */
function catalog(requests: ProductPageRequest[] = [], items: readonly ProductListItem[] = CATALOG, tree: ProductGroupTree = TREE): ProductRepository {
  return fakeProducts({
    list: async (request) => {
      requests.push(request);
      const search = (request.search ?? "").toLowerCase();
      const groupCodes = request.filters?.groupCodes;
      const rows = items.filter(
        (item) =>
          (search === "" || item.description.toLowerCase().includes(search) || String(item.code) === search) &&
          (groupCodes === undefined || (item.groupCode !== null && groupCodes.includes(item.groupCode))),
      );
      return pageOf(rows, rows.length);
    },
    groupTree: async () => tree,
  });
}
const last = (requests: ProductPageRequest[]) => requests[requests.length - 1]!;

describe("ProductsScreen (Catálogo)", () => {
  it("shows the title, the real count, the search hint and the grid cards with code, unit and price", async () => {
    await render(<ProductsScreen products={catalog()} onUnauthenticated={noop} />);
    expect(await screen.findByText("Tinta Azul 18L")).toBeTruthy();
    expect(screen.getByText("Catálogo")).toBeTruthy();
    expect(screen.getByText("4 produtos")).toBeTruthy();
    expect(screen.getByPlaceholderText("Buscar por código ou descrição")).toBeTruthy();
    expect(screen.getByText("Cód. 1 · UN")).toBeTruthy();
    expect(screen.getByText("R$ 120,50")).toBeTruthy();
  });

  it("is read-only outside an order: no add button, no customer", async () => {
    await render(<ProductsScreen products={catalog()} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    expect(screen.queryByRole("button", { name: /Adicionar/ })).toBeNull();
    expect(screen.queryByText("Cliente")).toBeNull();
  });

  it("toggles between grid and list keeping the search and filters", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.changeText(screen.getByPlaceholderText("Buscar por código ou descrição"), "tinta");
    expect(await screen.findByText("2 resultados")).toBeTruthy();

    await fireEvent.press(screen.getByRole("radio", { name: "Lista" }));
    expect(screen.getByRole("radio", { name: "Lista" }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByText("Código 1 · UN · Tintas")).toBeTruthy();
    expect(screen.getByDisplayValue("tinta")).toBeTruthy();
    expect(screen.getByText("2 resultados")).toBeTruthy();
    expect(screen.queryByText("Solvente 5L")).toBeNull();

    await fireEvent.press(screen.getByRole("radio", { name: "Grade" }));
    expect(screen.getByText("Cód. 1 · UN")).toBeTruthy();
  });

  it("searches by description and by code, and says so when nothing matches", async () => {
    await render(<ProductsScreen products={catalog()} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    const box = screen.getByPlaceholderText("Buscar por código ou descrição");
    await fireEvent.changeText(box, "4");
    await waitFor(() => expect(screen.queryByText("Tinta Azul 18L")).toBeNull());
    // findBy, not getBy: while the debounced search reloads, the old rows can disappear before the new ones are painted.
    expect(await screen.findByText("Pincel 2in")).toBeTruthy();
    await fireEvent.changeText(box, "zzz");
    expect(await screen.findByText("Nenhum produto encontrado para “zzz”.")).toBeTruthy();
  });

  /** Opens the level's list in the filter sheet and chooses an option by name. */
  async function pick(level: string, option: string) {
    await fireEvent.press(screen.getByRole("button", { name: new RegExp(`^${level}:`) }));
    await fireEvent.press(screen.getByRole("radio", { name: option }));
  }

  it("filters by group (cascade), shows a chip and the filtered count, and sends the subtree to the repository", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await pick("Grupo", "Tintas");
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("2 resultados")).toBeTruthy();
    expect(screen.queryByText("Solvente 5L")).toBeNull();
    expect(screen.getByRole("button", { name: "Remover filtro Grupo: Tintas" })).toBeTruthy();
    expect(last(requests).filters).toEqual({ groupPath: [10], groupCodes: [10, 11] });
  });

  it("Subgrupo is off until a group with children is chosen, and choosing a level clears the ones below", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByRole("button", { name: "Subgrupo: Todos os subgrupos" }).props.accessibilityState.disabled).toBe(true);
    await pick("Grupo", "Solventes");
    expect(screen.getByRole("button", { name: "Subgrupo: Todos os subgrupos" }).props.accessibilityState.disabled).toBe(true);
    await pick("Grupo", "Tintas");
    expect(screen.getByRole("button", { name: "Subgrupo: Todos os subgrupos" }).props.accessibilityState.disabled).toBe(false);
    await pick("Subgrupo", "Esmaltes");
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("Nenhum produto com estes filtros.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remover filtro Subgrupo: Esmaltes" })).toBeTruthy();
    expect(last(requests).filters).toEqual({ groupPath: [10, 11], groupCodes: [11] });

    // Back to the Grupo level: the subgrupo is cleared.
    await fireEvent.press(screen.getByRole("button", { name: "Filtros, 1 ativo(s)" }));
    await pick("Grupo", "Solventes");
    expect(screen.getByRole("button", { name: "Subgrupo: Todos os subgrupos" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(last(requests).filters).toEqual({ groupPath: [20], groupCodes: [20] });
  });

  it("removing the chip of a subgrupo falls back to its group", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await pick("Grupo", "Tintas");
    await pick("Subgrupo", "Esmaltes");
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Remover filtro Subgrupo: Esmaltes" }));
    expect(await screen.findByRole("button", { name: "Remover filtro Grupo: Tintas" })).toBeTruthy();
    expect(last(requests).filters).toEqual({ groupPath: [10], groupCodes: [10, 11] });
  });

  it("offers 'Sem grupo' only when some product has no group, and filters by code 0", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests, CATALOG, { ...TREE, hasUngrouped: true })} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await pick("Grupo", "Sem grupo");
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByRole("button", { name: "Remover filtro Grupo: Sem grupo" })).toBeTruthy();
    expect(last(requests).filters).toEqual({ groupPath: [0], groupCodes: [0] });
  });

  it("without a hierarchy it is the flat Grupo list (no Subgrupo)", async () => {
    const flat: ProductGroupTree = { hierarchical: false, hasUngrouped: false, items: [node(20, "Solventes", null, false, [20]), node(10, "Tintas", null, false, [10])] };
    await render(<ProductsScreen products={catalog([], CATALOG, flat)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.queryByRole("button", { name: /^Subgrupo:/ })).toBeNull();
    await pick("Grupo", "Tintas");
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("2 resultados")).toBeTruthy();
  });

  it("cancels without applying", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await pick("Grupo", "Solventes");
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Remover filtro Grupo: Solventes" })).toBeNull();
    expect(last(requests).filters).toBeUndefined();
  });

  it("combines search + group, and clears everything", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await pick("Grupo", "Tintas");
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    await fireEvent.changeText(screen.getByPlaceholderText("Buscar por código ou descrição"), "verde");
    expect(await screen.findByText("1 resultado")).toBeTruthy();
    expect(last(requests)).toMatchObject({ search: "verde", filters: { groupCodes: [10, 11] } });

    await fireEvent.press(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.queryByRole("button", { name: "Remover filtro Grupo: Tintas" })).toBeNull();
    expect(last(requests).filters).toBeUndefined();
  });

  it("has no price filter (owner 2026-11-13): only products with a price are in the catalog", async () => {
    await render(<ProductsScreen products={catalog()} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.queryByRole("radio", { name: "Com preço" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Sem preço" })).toBeNull();
  });

  it("says so when the filters match nobody", async () => {
    const onlyTintas = catalog([], CATALOG.filter((item) => item.groupCode === 10));
    await render(<ProductsScreen products={onlyTintas} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await pick("Grupo", "Solventes");
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("Nenhum produto com estes filtros.")).toBeTruthy();
  });

  it("tapping a card opens the product detail with brand, reference, group and price origin, and no cost or margin", async () => {
    const items = [product(7, { description: "Tinta Azul 18L", brand: "Marca X", reference: "REF-9", groupCode: 10, groupName: "Tintas", listPrice: priced("120.5") })];
    await render(<ProductsScreen products={catalog([], items)} onUnauthenticated={noop} />);
    await pressAndSettle(await screen.findByText("Tinta Azul 18L"));
    expect(await screen.findByLabelText("Marca: Marca X")).toBeTruthy();
    expect(screen.getByLabelText("Referência: REF-9")).toBeTruthy();
    expect(screen.getByLabelText("Grupo: Tintas")).toBeTruthy();
    expect(screen.getByLabelText("Origem do preço: Tabela 1")).toBeTruthy();
    expect(screen.queryByText(/custo|margem/i)).toBeNull();
  });

  it("shows 'Sem preço' (never R$ 0,00) for a product without a price, and keeps a real zero as R$ 0,00", async () => {
    const zero: ProductListItem["listPrice"] = { state: "zero", unitPrice: "0", tableCode: 1, versionId: 1 };
    await render(<ProductsScreen products={catalog([], [CATALOG[2]!, product(9, { description: "Brinde", listPrice: zero })])} onUnauthenticated={noop} />);
    expect(await screen.findByText("Sem preço")).toBeTruthy();
    expect(screen.getByText("Preço zero · R$ 0,00")).toBeTruthy();
  });

  it("shows a neutral placeholder (initials) for every product without image metadata, and never calls the image store", async () => {
    const resolve = jest.fn(async () => null);
    const store: ProductImageStore = { resolve, purge: async () => undefined };
    await render(
      <ProductImageProvider store={store} online>
        <ProductsScreen products={catalog()} onUnauthenticated={noop} />
      </ProductImageProvider>,
    );
    await screen.findByText("Tinta Azul 18L");
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getAllByText("TI", { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.getByText("PI", { includeHiddenElements: true })).toBeTruthy();
  });

  it("says the data comes from this device when offline and reads from the repository only", async () => {
    await render(<ProductsScreen products={catalog()} onUnauthenticated={noop} connectivity="offline" />);
    expect(await screen.findByText("4 produtos · dados salvos neste aparelho")).toBeTruthy();
  });

  it("says where the list prices come from (table, name, kind) like the site, and asks for the order customer's table", async () => {
    const asked: (number | undefined)[] = [];
    const products = fakeProducts({
      list: async () => pageOf([CATALOG[0]!]),
      pricesOrigin: async (customerCode) => {
        asked.push(customerCode);
        return customerCode === undefined
          ? { source: "catalog_reference", tableCode: 5, tableName: "Tabela Base" }
          : { source: "customer", tableCode: 7, tableName: "Atacado" };
      },
    });
    const { unmount } = await render(<ProductsScreen products={products} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    expect(screen.queryByText(/^Preços da tabela/)).toBeNull();
    await waitFor(() => expect(asked).toEqual([undefined]));
    await unmount();
    await render(<ProductBrowser products={products} onUnauthenticated={noop} customerCode={9} />);
    await screen.findByText("Tinta Azul 18L");
    expect(screen.queryByText(/^Preços da tabela/)).toBeNull();
    await waitFor(() => expect(asked.at(-1)).toBe(9));
  });

  it("product detail shows Ativo/Inativo, Uso and the origin with the table name, like the site", async () => {
    const item = product(7, { description: "Tinta Azul 18L", active: false, usageCode: "V", listPrice: priced("120.5") });
    const products = fakeProducts({
      list: async () => pageOf([item]),
      pricesOrigin: async () => ({ source: "customer", tableCode: 1, tableName: "Atacado" }),
    });
    await render(<ProductsScreen products={products} onUnauthenticated={noop} />);
    await pressAndSettle(await screen.findByText("Tinta Azul 18L"));
    expect(await screen.findByLabelText("Situação: Inativo")).toBeTruthy();
    expect(screen.getByLabelText("Uso: V")).toBeTruthy();
    expect(screen.getByLabelText("Origem do preço: Tabela 1 — Atacado (tabela do cliente)")).toBeTruthy();
  });

  it("product detail shows a dash for a product without usage and falls back to the table code when the origin is unknown", async () => {
    await render(<ProductsScreen products={catalog([], [product(7, { description: "Tinta Azul 18L", listPrice: priced("120.5") })])} onUnauthenticated={noop} />);
    await pressAndSettle(await screen.findByText("Tinta Azul 18L"));
    expect(await screen.findByLabelText("Situação: Ativo")).toBeTruthy();
    expect(screen.getByLabelText("Uso: —")).toBeTruthy();
    expect(screen.getByLabelText("Origem do preço: Tabela 1")).toBeTruthy();
  });

  it("shows no origin line when the device does not know the origin of the prices", async () => {
    await render(<ProductsScreen products={fakeProducts({ list: async () => pageOf([CATALOG[0]!]), pricesOrigin: async () => null })} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    expect(screen.queryByText(/^Preços da tabela/)).toBeNull();
  });

  it("hides the filter button when the repository cannot filter", async () => {
    await render(<ProductsScreen products={fakeProducts({ list: async () => pageOf([CATALOG[0]!]) })} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    expect(screen.queryByRole("button", { name: "Filtros" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Lista" })).toBeTruthy();
  });

  it("explains an empty catalog and a retryable error", async () => {
    await render(<ProductsScreen products={fakeProducts({ list: async () => pageOf([]) })} onUnauthenticated={noop} />);
    expect(await screen.findByText("Nenhum produto disponível")).toBeTruthy();
  });

  it("shows the loading text and then a retry button on error", async () => {
    let calls = 0;
    const flaky = fakeProducts({
      list: async () => {
        calls += 1;
        if (calls === 1) throw networkError();
        return pageOf([CATALOG[0]!]);
      },
    });
    await render(<ProductsScreen products={flaky} onUnauthenticated={noop} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Tinta Azul 18L")).toBeTruthy();
  });
});

describe("ProductBrowser in selection mode (Novo pedido)", () => {
  function Harness({ initial = {}, products = catalog() }: { initial?: Record<number, string>; products?: ProductRepository }) {
    const [cart, setCart] = useState<Record<number, string>>(initial);
    const actions: ProductOrderActions = {
      quantityOf: (code) => cart[code],
      onAdd: (item) => setCart((current) => ({ ...current, [item.code]: String(Number(current[item.code] ?? "0") + 1) })),
      onDecrement: (item) =>
        setCart((current) => {
          const { [item.code]: quantity, ...rest } = current;
          return quantity === "1" || quantity === undefined ? rest : { ...rest, [item.code]: String(Number(quantity) - 1) };
        }),
    };
    return <ProductBrowser products={products} actions={actions} onUnauthenticated={noop} />;
  }

  it("adds a product, shows its quantity with − and +, and steps the quantity without duplicating the card", async () => {
    await render(<Harness />);
    await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Tinta Azul 18L ao carrinho" }));
    expect(screen.getByLabelText("Quantidade no carrinho: 1")).toBeTruthy();
    expect(screen.getAllByText("Tinta Azul 18L")).toHaveLength(1);

    await pressAndSettle(screen.getByRole("button", { name: "Tinta Azul 18L, já no carrinho, adicionar outra unidade" }));
    expect(screen.getByLabelText("Quantidade no carrinho: 2")).toBeTruthy();

    await pressAndSettle(screen.getByRole("button", { name: "Diminuir quantidade de Tinta Azul 18L" }));
    expect(screen.getByLabelText("Quantidade no carrinho: 1")).toBeTruthy();

    await pressAndSettle(screen.getByRole("button", { name: "Remover Tinta Azul 18L do carrinho" }));
    expect(screen.getByRole("button", { name: "Adicionar Tinta Azul 18L ao carrinho" })).toBeTruthy();
  });

  it("shows a product already in the cart with its quantity in both grid and list", async () => {
    await render(<Harness initial={{ 4: "3" }} />);
    expect(await screen.findByLabelText("Quantidade no carrinho: 3")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Lista" }));
    expect(screen.getByLabelText("Quantidade no carrinho: 3")).toBeTruthy();
  });

  it("keeps the current rule for non-sellable products: no add button", async () => {
    const blocked = catalog([], [product(7, { description: "Descontinuado", sellable: false, listPrice: priced("5") })]);
    await render(<Harness products={blocked} />);
    expect(await screen.findByText("Indisponível para venda")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Adicionar Descontinuado/ })).toBeNull();
  });

  it("still offers a product without price (the order rule decides, not the catalog)", async () => {
    await render(<Harness products={catalog([], [CATALOG[2]!])} />);
    expect(await screen.findByText("Sem preço")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Adicionar Solvente 5L ao carrinho" })).toBeTruthy();
  });
});
