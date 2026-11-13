import { fireEvent, render, screen } from "@testing-library/react-native";
import type { CustomerRepository } from "../data/ports";
import { customer, pageOf } from "../test-doubles";
import { CustomerPicker } from "./customer-picker";

const noop = () => undefined;

describe("CustomerPicker (step 1)", () => {
  const customers: CustomerRepository = {
    list: async () => pageOf([customer(1, { name: "Sem dono", sellerCode: null }), customer(2, { name: "Com dono", sellerCode: 7 })], 2),
  };

  it("a customer without a seller cannot be picked (owner 2026-11-13): sealed, with the reason, and the press does nothing", async () => {
    const onSelect = jest.fn();
    await render(<CustomerPicker customers={customers} onSelect={onSelect} onUnauthenticated={noop} />);
    await screen.findByText("Sem dono");
    expect(screen.getAllByText("Sem vendedor")).toHaveLength(1);
    expect(screen.getAllByText("Cliente sem vendedor. Peça ao backoffice para atribuir.")).toHaveLength(1);
    const blocked = screen.getByRole("button", { name: "Selecionar cliente Sem dono" });
    expect(blocked).toBeDisabled();
    await fireEvent.press(blocked);
    expect(onSelect).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Selecionar cliente Com dono" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("filtering past orders (allowUnavailable) may still pick a customer without a seller", async () => {
    const onSelect = jest.fn();
    await render(<CustomerPicker customers={customers} onSelect={onSelect} onUnauthenticated={noop} allowUnavailable />);
    await screen.findByText("Sem dono");
    await fireEvent.press(screen.getByRole("button", { name: "Selecionar cliente Sem dono" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
