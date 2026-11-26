import { fireEvent, render, screen } from "@testing-library/react-native";
import { SellerPicker } from "./seller-picker";

const sellers = [
  { code: 3, name: "Zélia Souza" },
  { code: 1, name: "ÁLVARO Lima" },
  { code: 2, name: "Marcos José" },
];

const rows = () => screen.getAllByRole("radio").map((row) => row.props.accessibilityLabel as string);

describe("SellerPicker", () => {
  it("lists every seller alphabetically under the field Vendedor", async () => {
    await render(<SellerPicker sellers={sellers} selectedCode={null} onSelect={jest.fn()} />);
    expect(screen.getByText("Vendedor")).toBeTruthy();
    expect(rows()).toEqual(["Vendedor ÁLVARO Lima", "Vendedor Marcos José", "Vendedor Zélia Souza"]);
  });

  it("filters while typing, ignoring case and accent", async () => {
    await render(<SellerPicker sellers={sellers} selectedCode={null} onSelect={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText("Pesquisar vendedor"), "jose");
    expect(rows()).toEqual(["Vendedor Marcos José"]);
    await fireEvent.changeText(screen.getByLabelText("Pesquisar vendedor"), "ZELIA");
    expect(rows()).toEqual(["Vendedor Zélia Souza"]);
  });

  it("shows an empty list when nothing matches, with no message", async () => {
    await render(<SellerPicker sellers={sellers} selectedCode={null} onSelect={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText("Pesquisar vendedor"), "xyz");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("chooses on tap and marks the selected one", async () => {
    const onSelect = jest.fn();
    await render(<SellerPicker sellers={sellers} selectedCode={2} onSelect={onSelect} />);
    expect(screen.getByRole("radio", { name: "Vendedor Marcos José" }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole("radio", { name: "Vendedor Zélia Souza" }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("shows the error under the field", async () => {
    await render(<SellerPicker sellers={sellers} selectedCode={null} onSelect={jest.fn()} error="Escolha o vendedor." />);
    expect(screen.getByText("Escolha o vendedor.")).toBeTruthy();
  });
});
