import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CustomerRepository, ProductRepository } from "../data/ports";
import {
  account,
  customer,
  fakeAuth,
  fakeConnectivity,
  fakeDependencies,
  networkError,
  pageOf,
  product,
  unauthenticatedError,
} from "../test-doubles";
import { Shell } from "./shell";

const signedIn = () => fakeAuth({ getSession: async () => account });

describe("Shell", () => {
  it("shows the login form when there is no session", async () => {
    await render(<Shell dependencies={fakeDependencies()} />);
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("falls back to the login form when the session probe cannot reach the server", async () => {
    const auth = fakeAuth({
      getSession: async () => {
        throw networkError();
      },
    });
    await render(<Shell dependencies={fakeDependencies({ auth })} />);
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("lists the customers of an existing session and switches to the catalog", async () => {
    const customers: CustomerRepository = {
      list: async () => pageOf([customer(10, { name: "Padaria Central", blocked: true })]),
    };
    const products: ProductRepository = { list: async () => pageOf([product(5, { description: "Copo 200 ml" })]) };
    await render(
      <Shell dependencies={fakeDependencies({ auth: signedIn(), repositories: { customers, products } })} />,
    );
    expect(await screen.findByText("Padaria Central")).toBeTruthy();
    expect(screen.getByText("Bloqueado")).toBeTruthy();
    expect(screen.getByText("Ana Vendedora")).toBeTruthy();

    await fireEvent.press(screen.getByRole("tab", { name: "Catálogo" }));
    expect(await screen.findByText("Copo 200 ml")).toBeTruthy();
    // No price resolved: the catalog says so, it never shows zero (P-09).
    expect(screen.getByText("Sem preço")).toBeTruthy();
  });

  it("returns to the login form when a list request answers 401", async () => {
    const customers: CustomerRepository = {
      list: async () => {
        throw unauthenticatedError();
      },
    };
    await render(
      <Shell
        dependencies={fakeDependencies({
          auth: signedIn(),
          repositories: { customers, products: { list: async () => pageOf([]) } },
        })}
      />,
    );
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("signs out even when the logout call fails", async () => {
    const auth = fakeAuth({
      getSession: async () => account,
      logout: async () => {
        throw networkError();
      },
    });
    await render(<Shell dependencies={fakeDependencies({ auth })} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sair" }));
    expect(await screen.findByText("Entrar no Sales Force")).toBeTruthy();
  });

  it("tells the truth about offline: no data is kept on the device yet", async () => {
    const connectivity = fakeConnectivity("online");
    await render(<Shell dependencies={fakeDependencies({ auth: signedIn(), connectivity: connectivity.port })} />);
    expect(await screen.findByText("Online")).toBeTruthy();
    expect(screen.queryByText(/Esta versão ainda não guarda dados no aparelho/)).toBeNull();

    await act(async () => connectivity.emit("offline"));
    await waitFor(() => expect(screen.getByText("Sem conexão")).toBeTruthy());
    expect(screen.getByText(/Esta versão ainda não guarda dados no aparelho/)).toBeTruthy();
  });

  it("shows a retryable error when the list cannot be loaded offline", async () => {
    let calls = 0;
    const customers: CustomerRepository = {
      list: async () => {
        calls += 1;
        if (calls === 1) throw networkError();
        return pageOf([customer(1, { name: "Mercado Sul" })]);
      },
    };
    await render(
      <Shell
        dependencies={fakeDependencies({
          auth: signedIn(),
          repositories: { customers, products: { list: async () => pageOf([]) } },
        })}
      />,
    );
    await fireEvent.press(await screen.findByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Mercado Sul")).toBeTruthy();
  });
});
