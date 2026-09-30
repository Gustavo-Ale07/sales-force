import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CustomerRepository } from "../data/ports";
import { customer, networkError, pageOf } from "../test-doubles";
import { CustomersScreen } from "./customers-screen";

const noop = () => undefined;

describe("CustomersScreen", () => {
  it("shows a visible search hint, the local count and compact rows", async () => {
    const customers: CustomerRepository = {
      list: async () => pageOf([customer(10, { name: "Padaria Central", document: "12345678000190" })], 250),
    };
    await render(<CustomersScreen customers={customers} onUnauthenticated={noop} />);
    expect(await screen.findByText("Padaria Central")).toBeTruthy();
    expect(screen.getByPlaceholderText("Buscar por nome, código ou documento")).toBeTruthy();
    expect(screen.getByText("250 clientes")).toBeTruthy();
    expect(screen.getByText(/Código 10 · 12345678000190/)).toBeTruthy();
  });

  it("says the data comes from this device when offline", async () => {
    const customers: CustomerRepository = { list: async () => pageOf([customer(1, { name: "Mercado Sul" })], 1) };
    await render(<CustomersScreen customers={customers} onUnauthenticated={noop} connectivity="offline" />);
    expect(await screen.findByText("1 cliente · dados salvos neste aparelho")).toBeTruthy();
  });

  it("explains an empty portfolio and a search without results", async () => {
    const customers: CustomerRepository = { list: async () => pageOf([]) };
    await render(<CustomersScreen customers={customers} onUnauthenticated={noop} />);
    expect(await screen.findByText("Nenhum cliente disponível")).toBeTruthy();
    expect(screen.getByText(/Conecte-se e sincronize/)).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText("Buscar por nome, código ou documento"), "zzz");
    expect(await screen.findByText("Nenhum cliente encontrado para “zzz”.")).toBeTruthy();
  });

  it("shows the loading text, then a retryable error", async () => {
    let calls = 0;
    const customers: CustomerRepository = {
      list: async () => {
        calls += 1;
        if (calls === 1) throw networkError();
        return pageOf([customer(1, { name: "Mercado Sul" })]);
      },
    };
    await render(<CustomersScreen customers={customers} onUnauthenticated={noop} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByText("Mercado Sul")).toBeTruthy());
  });
});
