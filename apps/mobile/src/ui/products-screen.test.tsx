import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
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

const GROUPS = [
  { code: 10, name: "Tintas", count: 2 },
  { code: 20, name: "Solventes", count: 1 },
  { code: 30, name: "Acessórios", count: 1 },
];

/** A repository that filters like the offline cache does: search on description/code, groups, price state. */
function catalog(requests: ProductPageRequest[] = [], items: readonly ProductListItem[] = CATALOG): ProductRepository {
  return fakeProducts({
    list: async (request) => {
      requests.push(request);
      const search = (request.search ?? "").toLowerCase();
      const groupCodes = request.filters?.groupCodes;
      const priceState = request.filters?.priceState;
      const rows = items.filter(
        (item) =>
          (search === "" || item.description.toLowerCase().includes(search) || String(item.code) === search) &&
          (groupCodes === undefined || (item.groupCode !== null && groupCodes.includes(item.groupCode))) &&
          (priceState === undefined || (priceState === "none") === (item.listPrice.state === "none")),
      );
      return pageOf(rows, rows.length);
    },
    groups: async () => GROUPS,
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
    expect(screen.getByText("Pincel 2in")).toBeTruthy();
    await fireEvent.changeText(box, "zzz");
    expect(await screen.findByText("Nenhum produto encontrado para “zzz”.")).toBeTruthy();
  });

  it("filters by group, shows a chip and the filtered count, and sends the filter to the repository", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Tintas, 2 produtos" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("2 resultados")).toBeTruthy();
    expect(screen.queryByText("Solvente 5L")).toBeNull();
    expect(screen.getByRole("button", { name: "Remover filtro Grupo: Tintas" })).toBeTruthy();
    expect(last(requests).filters).toEqual({ groupCodes: [10] });
  });

  it("selects several groups, cancels without applying, and searches inside the group list", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Solventes, 1 produto" }));
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Remover filtro Grupo: Solventes" })).toBeNull();
    expect(last(requests).filters).toBeUndefined();

    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.changeText(screen.getByLabelText("Buscar grupo"), "acess");
    expect(screen.queryByRole("checkbox", { name: /Tintas/ })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Buscar grupo"), "");
    await fireEvent.press(screen.getByRole("checkbox", { name: "Solventes, 1 produto" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Acessórios, 1 produto" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("2 resultados")).toBeTruthy();
    expect(last(requests).filters).toEqual({ groupCodes: [20, 30] });
  });

  it("combines search + group, removes one chip and clears everything", async () => {
    const requests: ProductPageRequest[] = [];
    await render(<ProductsScreen products={catalog(requests)} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Tintas, 2 produtos" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Com preço" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    await fireEvent.changeText(screen.getByPlaceholderText("Buscar por código ou descrição"), "verde");
    expect(await screen.findByText("1 resultado")).toBeTruthy();
    expect(last(requests)).toMatchObject({ search: "verde", filters: { groupCodes: [10], priceState: "priced" } });

    await fireEvent.press(screen.getByRole("button", { name: "Remover filtro Com preço" }));
    await screen.findByRole("button", { name: "Remover filtro Grupo: Tintas" });
    expect(last(requests).filters).toEqual({ groupCodes: [10] });

    await fireEvent.press(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.queryByRole("button", { name: "Remover filtro Grupo: Tintas" })).toBeNull();
    expect(last(requests).filters).toBeUndefined();
  });

  it("says so when the filters match nobody", async () => {
    const onlyTintas = catalog([], CATALOG.filter((item) => item.groupCode === 10));
    await render(<ProductsScreen products={onlyTintas} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Solventes, 1 produto" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("Nenhum produto com estes filtros.")).toBeTruthy();
  });

  it("shows 'Sem preço' (never R$ 0,00) for a product without a price, and keeps a real zero as R$ 0,00", async () => {
    const zero: ProductListItem["listPrice"] = { state: "zero", unitPrice: "0", tableCode: 1, versionId: 1 };
    await render(<ProductsScreen products={catalog([], [CATALOG[2]!, product(9, { description: "Brinde", listPrice: zero })])} onUnauthenticated={noop} />);
    expect(await screen.findByText("Sem preço")).toBeTruthy();
    expect(screen.getByText("R$ 0,00")).toBeTruthy();
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

  it("hides the filter button when the repository cannot filter", async () => {
    await render(<ProductsScreen products={fakeProducts({ list: async () => pageOf([CATALOG[0]!]) })} onUnauthenticated={noop} />);
    await screen.findByText("Tinta Azul 18L");
    expect(screen.queryByRole("button", { name: "Filtros" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Lista" })).toBeTruthy();
  });

  it("explains an empty catalog and a retryable error", async () => {
    await render(<ProductsScreen products={fakeProducts({ list: async () => pageOf([]) })} onUnauthenticated={noop} />);
    expect(await screen.findByText("Nenhum produto disponível")).toBeTruthy();
    expect(screen.getByText(/Conecte-se e sincronize/)).toBeTruthy();
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
