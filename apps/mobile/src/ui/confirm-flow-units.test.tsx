import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { commitQuantityText, previewDraft, quantityProblemMessages, type EditorLine } from "../data/order-draft";
import { createProductImageStore } from "../images/image-store";
import { memoryImageFileSystem, ok, PNG } from "../images/image-test-doubles";
import { ProductImageProvider } from "../images/product-image-context";
import { BottomNav } from "./bottom-nav";
import { CartView } from "./cart-view";
import { Icon, type IconName } from "./icons";
import { QuantityField } from "./quantity-field";

const noop = () => undefined;

describe("commitQuantityText", () => {
  it.each([
    ["2", false, { kind: "set", quantityText: "2" }],
    ["2,5", false, { kind: "set", quantityText: "2,5" }],
    ["0,2500", false, { kind: "set", quantityText: "0,25" }],
    ["0", true, { kind: "remove" }],
    ["0", false, { kind: "revert", problem: "not_positive" }],
    ["", true, { kind: "revert", problem: "empty" }],
    ["abc", false, { kind: "revert", problem: "not_a_decimal" }],
    ["1,2345,6", false, { kind: "revert", problem: "not_a_decimal" }],
    ["1,23456", false, { kind: "revert", problem: "too_many_decimals" }],
    ["1.000,5", false, { kind: "revert", problem: "not_a_decimal" }],
  ] as const)("%j (zeroRemoves %j) -> %j", (typed, zeroRemoves, expected) => {
    expect(commitQuantityText(typed, zeroRemoves)).toEqual(expected);
  });

  it("has a seller text for every problem it can return", () => {
    for (const typed of ["", "x", "0", "-1", "1,23456"]) {
      const result = commitQuantityText(typed, false);
      if (result.kind === "revert") expect(quantityProblemMessages[result.problem]).toMatch(/\S/);
    }
  });
});

describe("QuantityField", () => {
  const field = (onCommit: jest.Mock, value = "3", zeroRemoves = false) => render(<QuantityField value={value} productName="Copo" zeroRemoves={zeroRemoves} onCommit={onCommit} />);
  const input = () => screen.getByLabelText("Quantidade de Copo");

  // changeText and blur are separate acts: the commit reads the draft from the render that followed the typing.
  async function type(text: string, finish: "blur" | "submit" = "blur") {
    await act(async () => {
      fireEvent.changeText(input(), text);
    });
    await act(async () => {
      fireEvent(input(), finish === "blur" ? "blur" : "submitEditing");
    });
  }

  it("typing alone changes nothing; blur commits a valid number", async () => {
    const onCommit = jest.fn();
    await field(onCommit);
    await act(async () => {
      fireEvent.changeText(input(), "5");
    });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent(input(), "blur");
    });
    expect(onCommit).toHaveBeenCalledWith({ kind: "set", quantityText: "5" });
  });

  it("the keyboard's 'done' commits too", async () => {
    const onCommit = jest.fn();
    await field(onCommit);
    await type("7,5", "submit");
    expect(onCommit).toHaveBeenCalledWith({ kind: "set", quantityText: "7,5" });
  });

  it("an invalid value goes back to the last valid one with the inline message", async () => {
    const onCommit = jest.fn();
    await field(onCommit);
    await type("abc");
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("Quantidade inválida.")).toBeTruthy();
    expect((input().props as { value: string }).value).toBe("3");
  });

  it("zero removes the product in the catalog", async () => {
    const remove = jest.fn();
    await field(remove, "3", true);
    await type("0");
    expect(remove).toHaveBeenCalledWith({ kind: "remove" });
  });

  it("zero is refused in the cart", async () => {
    const cart = jest.fn();
    await field(cart, "3", false);
    await type("0");
    expect(cart).not.toHaveBeenCalled();
    expect(screen.getByText("A quantidade deve ser maior que zero.")).toBeTruthy();
  });

  it("typing the value already held does not report a change", async () => {
    const onCommit = jest.fn();
    await field(onCommit, "3");
    await type("3");
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("BottomNav Vendas counter (orders awaiting send)", () => {
  it("shows the number of pending orders on Vendas, '99+' above 99, and nothing at zero", async () => {
    const { rerender } = await render(<BottomNav active="home" onSelect={noop} badges={{ sales: 3 }} />);
    expect(screen.getByText("3")).toBeTruthy();
    await rerender(<BottomNav active="home" onSelect={noop} badges={{ sales: 120 }} />);
    expect(screen.getByText("99+")).toBeTruthy();
    await rerender(<BottomNav active="home" onSelect={noop} badges={{ sales: 0 }} />);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("99+")).toBeNull();
  });
});

describe("Icons", () => {
  const NAMES: readonly IconName[] = ["home", "customers", "sales", "catalog", "profile", "products", "cart", "check", "close", "select"];
  it.each(NAMES)("%s renders as vector views, never text", async (name) => {
    await render(<Icon name={name} color="#123456" />);
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toBe("null");
    expect(tree).toContain("#123456");
    expect(tree).not.toMatch(/"children":\["[^"]+"\]/);
  });
});

describe("Thumb in the cart", () => {
  const line: EditorLine = {
    key: "k1",
    productCode: 1,
    description: "Tinta 1",
    unit: "UN",
    quantityText: "2",
    discountText: "",
    imageVersion: "v1",
    price: { state: "priced", unitPrice: "10", tableCode: 1, versionId: 1 },
  };

  it("shows the product's stored thumbnail on the cart line", async () => {
    const memory = memoryImageFileSystem();
    const store = createProductImageStore({ fs: memory.fs, fetchThumbnail: async () => ok(PNG), scope: async () => "owner|production|ds", now: () => Date.now(), timeoutMs: 30 });
    await render(
      <ProductImageProvider store={store} online>
        <CartView lines={[line]} preview={previewDraft([line])} onQuantityChange={noop} onDiscountChange={noop} onDiscountCommit={noop} onRemove={noop} selectionMode={false} selected={new Set()} onToggleSelect={noop} onLongPressLine={noop} />
      </ProductImageProvider>,
    );
    expect(await screen.findByTestId("product-thumb-1", { includeHiddenElements: true }, { timeout: 5000 })).toBeTruthy();
  });
});
