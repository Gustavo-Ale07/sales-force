import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions, PixelRatio, StyleSheet } from "react-native";
import { lineFromProduct } from "../data/order-draft";
import { fakeProducts, product } from "../test-doubles";
import { BulkDiscountSheet } from "./bulk-discount-sheet";

const priced = { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } as const;
const lines = [4158, 4159, 1439].map((code, index) =>
  lineFromProduct(product(code, { groupCode: index < 2 ? 30 : 40, groupName: index < 2 ? "Copos" : "Pratos", listPrice: priced, maxDiscountPercent: "12" }), `k${code}`),
);

const CONDITIONS: Array<[string, number, number, number]> = [
  ["320x568, font 1.3", 320, 568, 1.3],
  ["360x800, font 1.0", 360, 800, 1],
];

describe.each(CONDITIONS)("BulkDiscountSheet at %s", (_name, width, height, fontScale) => {
  beforeEach(() => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width, height, scale: 2, fontScale });
    jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(fontScale);
  });
  afterEach(() => jest.restoreAllMocks());

  async function open(onApply = jest.fn(), onClose = jest.fn()) {
    await render(<BulkDiscountSheet visible lines={lines} products={fakeProducts()} onApply={onApply} onClose={onClose} />);
    return { onApply, onClose };
  }
  const minHeight = (node: { props: { style?: unknown } }) => ((s) => s.minHeight ?? s.height ?? 0)(StyleSheet.flatten(node.props.style as never) as { minHeight?: number; height?: number });

  it("keeps the keyboard off the footer: avoiding view and scroll body, the Aplicar button outside the scroll", async () => {
    await open();
    expect(screen.getByTestId("bulk-discount-avoiding")).toBeTruthy();
    const scroll = screen.getByTestId("bulk-discount-scroll");
    expect(scroll).toBeTruthy();
    const apply = screen.getByTestId("bulk-discount-apply");
    let node = apply.parent;
    while (node !== null) {
      expect(node.props.testID).not.toBe("bulk-discount-scroll");
      node = node.parent;
    }
  });

  it("shows the target list, the percentage field and the count inside the Aplicar button", async () => {
    await open();
    expect(screen.getByRole("radio", { name: "Todos os itens" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Copos" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Pratos" })).toBeTruthy();
    expect(screen.getByLabelText("Desconto (%)")).toBeTruthy();
    expect(screen.getByText("Aplicar")).toBeTruthy();
    expect(screen.getByText("3 itens afetados")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole("radio", { name: "Pratos" }));
    });
    expect(screen.getByText("1 item afetado")).toBeTruthy();
  });

  it("keeps every touch target at 44 points or more", async () => {
    await open();
    for (const name of ["Diminuir desconto", "Aumentar desconto", "Aplicar desconto", "Cancelar"]) {
      expect(minHeight(screen.getByRole("button", { name }))).toBeGreaterThanOrEqual(44);
    }
    for (const radio of screen.getAllByRole("radio")) expect(minHeight(radio)).toBeGreaterThanOrEqual(44);
  });

  it("applies only with a valid percentage, to the chosen target, and does not close itself", async () => {
    const { onApply, onClose } = await open();
    const apply = screen.getByRole("button", { name: "Aplicar desconto" });
    await act(async () => {
      fireEvent.press(apply);
    });
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByRole("radio", { name: "Copos" }));
      fireEvent.changeText(screen.getByLabelText("Desconto (%)"), "15");
    });
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Aplicar desconto" }));
    });
    // above the 12% limit: the same sheet asks, nothing is applied yet
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText("Acima do limite (2)")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Sim" }));
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    const after = onApply.mock.calls[0][1] as typeof lines;
    expect(after.map((line) => line.discountText)).toEqual(["15", "15", ""]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Não closes the sheet and applies nothing; a product without DESCMAX is never listed as above", async () => {
    const mixed = [
      lineFromProduct(product(1, { description: "Com limite", listPrice: priced, maxDiscountPercent: "12" }), "a"),
      lineFromProduct(product(2, { description: "Sem limite", listPrice: priced, maxDiscountPercent: null }), "b"),
    ];
    const onApply = jest.fn();
    const onClose = jest.fn();
    await render(<BulkDiscountSheet visible lines={mixed} products={fakeProducts()} onApply={onApply} onClose={onClose} />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText("Desconto (%)"), "30");
    });
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Aplicar desconto" }));
    });
    expect(screen.getByText("Acima do limite (1)")).toBeTruthy();
    expect(screen.getByText("Dentro do limite (1)")).toBeTruthy();
    expect(screen.getByText("Com limite: máx. 12%, digitado 30%")).toBeTruthy();
    expect(screen.getByText("Sem limite")).toBeTruthy();
    expect(screen.queryByText(/Sem limite: máx/)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Não" }));
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies at once, without a question, when nothing is above a limit or the order is already accepted", async () => {
    const onApply = jest.fn();
    await render(<BulkDiscountSheet visible lines={lines} products={fakeProducts()} overLimitAccepted onApply={onApply} onClose={jest.fn()} />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText("Desconto (%)"), "30");
    });
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Aplicar desconto" }));
    });
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
