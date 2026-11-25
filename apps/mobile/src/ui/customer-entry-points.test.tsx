import { render, screen } from "@testing-library/react-native";
import type { CustomerRepository } from "../data/ports";
import { customer, pageOf } from "../test-doubles";
import { CustomerDetailScreen } from "./customer-detail-screen";
import { CustomersScreen } from "./customers-screen";

const repo: CustomerRepository = { list: async () => pageOf([]) };

describe("customer form entry points follow the released flags", () => {
  it("no 'Novo cliente' button while creation is not released", async () => {
    await render(<CustomersScreen customers={repo} onUnauthenticated={jest.fn()} />);
    await screen.findByText("Clientes");
    expect(screen.queryByLabelText("Novo cliente")).toBeNull();
  });

  it("'Novo cliente' appears when creation is released", async () => {
    await render(<CustomersScreen customers={repo} onUnauthenticated={jest.fn()} onCreate={jest.fn()} />);
    expect(await screen.findByLabelText("Novo cliente")).toBeTruthy();
  });

  it("no 'Editar cliente' button while edit is not released", async () => {
    await render(<CustomerDetailScreen customer={customer(10)} customers={repo} onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(screen.queryByLabelText("Editar cliente")).toBeNull();
  });

  it("'Editar cliente' appears when edit is released", async () => {
    await render(<CustomerDetailScreen customer={customer(10)} customers={repo} onBack={jest.fn()} onNewOrder={jest.fn()} onEdit={jest.fn()} />);
    expect(screen.getByLabelText("Editar cliente")).toBeTruthy();
  });
});
