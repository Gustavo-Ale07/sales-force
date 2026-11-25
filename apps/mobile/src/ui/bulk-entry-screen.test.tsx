import { fireEvent, render, screen } from "@testing-library/react-native";
import { fakeProducts, pageOf, product } from "../test-doubles";
import { BulkEntryScreen } from "./bulk-entry-screen";

const priced = { state: "priced" as const, unitPrice: "10.00", tableCode: 1, versionId: 1 };

async function setup(existing: number[] = []) {
  const onAdd = jest.fn();
  const catalog = [product(1001, { listPrice: priced }), product(1002, { listPrice: priced, reference: "REF-22" })];
  const products = fakeProducts({
    list: async ({ search }) => pageOf(catalog.filter((item) => String(item.code).includes(search) || (item.reference ?? "").includes(search))),
  });
  let n = 0;
  await render(
    <BulkEntryScreen products={products} customerCode={10} existingCodes={new Set(existing)} isPriceOrderable={(state) => state === "priced"} onAdd={onAdd} onClose={jest.fn()} newKey={() => `k-${++n}`} />,
  );
  return { onAdd };
}

describe("BulkEntryScreen", () => {
  it("reviews each line with its reason and adds only the valid ones, with the typed quantity", async () => {
    const { onAdd } = await setup([1002]);
    await fireEvent.changeText(await screen.findByLabelText("Linhas do lançamento"), "1001;2,5\nREF-22;1\n9999;1\n1001;0");
    await fireEvent.press(screen.getByLabelText("Conferir"));
    expect(await screen.findByText("1 de 4 linhas serão adicionadas")).toBeTruthy();
    expect(screen.getByText("Produto já está no pedido.")).toBeTruthy();
    expect(screen.getByText("Produto não encontrado.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Adicionar 1 item"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].map((line: { productCode: number; quantityText: string }) => [line.productCode, line.quantityText])).toEqual([[1001, "2,5"]]);
  });

  it("says what to paste when the text has no lines", async () => {
    await setup();
    await fireEvent.changeText(await screen.findByLabelText("Linhas do lançamento"), " \n ");
    expect(screen.getByLabelText("Conferir").props.accessibilityState?.disabled).toBe(true);
  });
});
