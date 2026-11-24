import { render, screen } from "@testing-library/react-native";
import { Dimensions, PixelRatio, StyleSheet } from "react-native";
import { previewDraft, type EditorLine } from "../data/order-draft";
import { product } from "../test-doubles";
import { CartView } from "./cart-view";
import { ProductCard, ProductRow, ROW_ACTION_WIDTH, type ProductOrderActions } from "./product-views";

/**
 * Jest does not measure layout. These checks pin the rules that stop the "- qty +" control from overflowing a product row
 * (fixed reserved action width, shrinkable text, bounded field, no fixed heights). Real pixels are confirmed on a device.
 */
const noop = () => undefined;
const actions: ProductOrderActions = { quantityOf: () => undefined, onAdd: noop, onDecrement: noop, onSetQuantity: noop };
const LONG = "Tinta Acrilica Premium Fosca Antimofo Rendimento Superior para Paredes Internas e Externas 18 Litros Branco Neve";

type Json = { type: string; props: Record<string, unknown>; children?: Array<Json | string> | null };
const styleOf = (node: Json) => (StyleSheet.flatten(node.props["style"] as never) ?? {}) as Record<string, unknown>;
function all(node: Json | Json[] | null): Json[] {
  if (node === null) return [];
  if (Array.isArray(node)) return node.flatMap(all);
  return [node, ...(node.children ?? []).flatMap((child) => (typeof child === "string" ? [] : all(child)))];
}
const tree = () => all(screen.toJSON() as Json | Json[] | null);

const CONDITIONS: Array<[string, number, number]> = [
  ["360 dp, font 1.0", 360, 1],
  ["360 dp, font 1.3", 360, 1.3],
  ["360 dp, font 1.5", 360, 1.5],
  ["320 dp, font 1.5", 320, 1.5],
];

describe.each(CONDITIONS)("quantity control layout at %s", (_name, width, fontScale) => {
  beforeEach(() => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width, height: 800, scale: 2, fontScale });
    jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(fontScale);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(["12,4", "123,4", "4"])("list row with quantity %s: control inside the reserved area, text keeps room", async (quantity) => {
    await render(<ProductRow product={product(1, { description: LONG })} quantity={quantity} actions={actions} />);
    const nodes = tree();
    const row = nodes.find((n) => styleOf(n)["flexDirection"] === "row" && styleOf(n)["gap"] !== undefined)!;
    const rowStyle = styleOf(row);
    // Fixed widths of the row (thumb 48, reserved action, gaps, padding) leave a useful text column.
    const padding = (rowStyle["padding"] as number) * 2;
    const gap = rowStyle["gap"] as number;
    const used = 48 + ROW_ACTION_WIDTH + gap * 2 + padding + 2;
    expect(width - used - 2 * 4 /* list margin */).toBeGreaterThanOrEqual(90);
    const info = nodes.find((n) => styleOf(n)["flex"] === 1 && styleOf(n)["minWidth"] === 0 && styleOf(n)["gap"] === 1)!;
    expect(styleOf(info)["flexShrink"]).toBe(1);
    const action = nodes.find((n) => styleOf(n)["width"] === ROW_ACTION_WIDTH)!;
    expect(styleOf(action)["flexShrink"]).toBe(0);
    // The stepper is bounded by its container; buttons are fixed, the field is the shrinkable part.
    const stepper = nodes.find((n) => styleOf(n)["maxWidth"] === "100%" && styleOf(n)["borderWidth"] === 1)!;
    expect(styleOf(stepper)["overflow"]).toBe("hidden");
    const buttons = nodes.filter((n) => n.props["accessibilityRole"] === "button");
    const buttonWidth = buttons.reduce((sum, b) => sum + (styleOf(b)["width"] as number), 0);
    expect(ROW_ACTION_WIDTH - 2 - buttonWidth).toBeGreaterThanOrEqual(50); // room for "123,4" at the capped font scale
    const input = nodes.find((n) => n.type === "TextInput")!;
    expect(styleOf(input)["minWidth"]).toBe(0);
    expect(styleOf(input)["width"]).toBe("100%");
    expect(input.props["maxFontSizeMultiplier"]).toBeLessThanOrEqual(1.3);
    expect(nodes.find((n) => styleOf(n)["flex"] === 1 && styleOf(n)["flexShrink"] === 1 && styleOf(n)["minWidth"] === 0 && n !== info)).toBeTruthy(); // field wrapper
    // The name is capped at two lines and nothing in the row has a fixed height above the thumbnail or aspect ratio.
    expect(screen.getByText(LONG).props.numberOfLines).toBe(2);
    for (const n of nodes) {
      expect(styleOf(n)["aspectRatio"]).toBeUndefined();
      const h = styleOf(n)["height"];
      if (typeof h === "number") expect(h).toBeLessThanOrEqual(48);
    }
  });

  it("list row without quantity: Adicionar sits in the same reserved area and shrinks its text", async () => {
    await render(<ProductRow product={product(1, { description: LONG })} actions={actions} />);
    const nodes = tree();
    expect(nodes.some((n) => styleOf(n)["width"] === ROW_ACTION_WIDTH)).toBe(true);
    const label = screen.getByText("Adicionar");
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    const button = screen.getByRole("button", { name: /Adicionar/ });
    expect(styleOf(button as unknown as Json)["minWidth"]).toBe(0);
  });

  it("grid card with quantity: the control stretches to the card, never a fixed row width, no card height", async () => {
    await render(<ProductCard product={product(1, { description: LONG })} quantity="123,4" actions={actions} />);
    const nodes = tree();
    expect(nodes.some((n) => styleOf(n)["width"] === ROW_ACTION_WIDTH)).toBe(false);
    const stepper = nodes.find((n) => styleOf(n)["maxWidth"] === "100%" && styleOf(n)["borderWidth"] === 1)!;
    expect(styleOf(stepper)["alignSelf"]).toBe("stretch");
    expect(nodes.find((n) => n.type === "TextInput")!.props["maxFontSizeMultiplier"]).toBeLessThanOrEqual(1.3);
    expect(screen.getByText(LONG).props.numberOfLines).toBe(2);
    for (const n of nodes) {
      const h = styleOf(n)["height"];
      if (typeof h === "number") expect(h).toBeLessThanOrEqual(48);
    }
  });

  it("cart line with a long name and quantity 123,4: columns can shrink (minWidth 0) and the unit shrinks", async () => {
    const line: EditorLine = {
      key: "k1",
      productCode: 1,
      description: LONG,
      unit: "UN",
      quantityText: "123,4",
      discountText: "",
      price: { state: "priced", unitPrice: "10", tableCode: 1, versionId: 1 },
    };
    await render(
      <CartView lines={[line]} preview={previewDraft([line])} onQuantityChange={noop} onDiscountChange={noop} onDiscountCommit={noop} onRemove={noop} selectionMode={false} selected={new Set()} onToggleSelect={noop} onLongPressLine={noop} />,
    );
    const nodes = tree();
    expect(nodes.filter((n) => styleOf(n)["flex"] === 3 && styleOf(n)["minWidth"] === 0)).toHaveLength(1);
    expect(nodes.filter((n) => styleOf(n)["flex"] === 2 && styleOf(n)["minWidth"] === 0)).toHaveLength(1);
    expect(nodes.some((n) => styleOf(n)["flex"] === 1 && styleOf(n)["minWidth"] === 0 && styleOf(n)["gap"] === 2)).toBe(true);
    expect(styleOf(nodes.find((n) => n.type === "TextInput" && n.props["accessibilityLabel"] === `Quantidade de ${LONG}`)!)["width"]).toBe("100%");
    expect(screen.getByText("UN").props.style).toEqual(expect.objectContaining({ flexShrink: 1 }));
  });
});
