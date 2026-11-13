import { fireEvent, render, screen } from "@testing-library/react-native";
import type { CustomerRepository } from "../data/ports";
import { customer, pageOf } from "../test-doubles";
import { CustomerPicker } from "./customer-picker";

const noop = () => undefined;

describe("CustomerPicker (step 1)", () => {
  it("shows the 'Sem vendedor' seal and still lets the seller pick the customer (no ordering rule is invented)", async () => {
    const onSelect = jest.fn();
    const customers: CustomerRepository = {
      list: async () => pageOf([customer(1, { name: "Sem dono", sellerCode: null }), customer(2, { name: "Com dono", sellerCode: 7 })], 2),
    };
    await render(<CustomerPicker customers={customers} onSelect={onSelect} onUnauthenticated={noop} />);
    await screen.findByText("Sem dono");
    expect(screen.getAllByText("Sem vendedor")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Selecionar cliente Sem dono" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
