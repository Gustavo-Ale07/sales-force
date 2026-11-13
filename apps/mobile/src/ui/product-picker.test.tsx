import { render, screen } from "@testing-library/react-native";
import type { ProductPageRequest } from "../data/ports";
import { fakeProducts, pageOf } from "../test-doubles";
import { ProductPicker } from "./product-picker";

const actions = { quantityOf: () => undefined, onAdd: jest.fn(), onDecrement: jest.fn() };

describe("ProductPicker (step 2)", () => {
  it("asks for the catalog of the order customer's price table", async () => {
    const requests: ProductPageRequest[] = [];
    const products = fakeProducts({
      list: async (request) => {
        requests.push(request);
        return pageOf([]);
      },
    });
    await render(<ProductPicker products={products} customerCode={42} actions={actions} onUnauthenticated={() => undefined} />);
    await screen.findByText("Nenhum produto disponível");
    expect(requests[0]).toMatchObject({ customerCode: 42 });
  });

  it("without a customer it is the plain catalog (reference table)", async () => {
    const requests: ProductPageRequest[] = [];
    const products = fakeProducts({
      list: async (request) => {
        requests.push(request);
        return pageOf([]);
      },
    });
    await render(<ProductPicker products={products} actions={actions} onUnauthenticated={() => undefined} />);
    await screen.findByText("Nenhum produto disponível");
    expect(requests[0]).not.toHaveProperty("customerCode");
  });
});
