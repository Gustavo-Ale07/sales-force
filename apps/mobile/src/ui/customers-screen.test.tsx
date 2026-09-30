import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CustomerPageRequest, CustomerRepository } from "../data/ports";
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

  describe("filters and index", () => {
    const sellers = [
      { code: 7, name: "Ana", count: 2 },
      { code: 9, name: "Bia", count: 1 },
    ];
    function repo(requests: CustomerPageRequest[] = []): CustomerRepository {
      return {
        list: async (request) => {
          requests.push(request);
          const status = request.filters?.status;
          const rows = [customer(1, { name: "Açúcar" }), customer(2, { name: "Bar", blocked: true })].filter((c) => (status === "blocked" ? c.blocked : true));
          return pageOf(rows, rows.length);
        },
        sellers: async () => sellers,
        letters: async () => [
          { letter: "A", count: 1, offset: 0 },
          { letter: "B", count: 1, offset: 1 },
        ],
      };
    }
    const last = (requests: CustomerPageRequest[]) => requests[requests.length - 1]!;

    it("applies a real filter from the sheet, shows a chip and the filtered count, and sends it to the repository", async () => {
      const requests: CustomerPageRequest[] = [];
      await render(<CustomersScreen customers={repo(requests)} onUnauthenticated={noop} />);
      await screen.findByText("Açúcar");
      await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
      await fireEvent.press(screen.getByRole("radio", { name: "Bloqueados" }));
      await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
      expect(await screen.findByText("1 resultado")).toBeTruthy();
      expect(screen.queryByText("Açúcar")).toBeNull();
      expect(screen.getByRole("button", { name: "Remover filtro Bloqueados" })).toBeTruthy();
      expect(last(requests).filters).toEqual({ status: "blocked" });
    });

    it("combines status and seller, removes one chip, then clears everything", async () => {
      const requests: CustomerPageRequest[] = [];
      await render(<CustomersScreen customers={repo(requests)} onUnauthenticated={noop} />);
      await screen.findByText("Açúcar");
      await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
      await fireEvent.press(screen.getByRole("radio", { name: "Ativos" }));
      await fireEvent.press(screen.getByRole("radio", { name: "Ana" }));
      await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
      await screen.findByRole("button", { name: "Remover filtro Vendedor: Ana" });
      expect(last(requests).filters).toEqual({ status: "active", sellerCode: 7 });

      await fireEvent.press(screen.getByRole("button", { name: "Remover filtro Ativos" }));
      await screen.findByRole("button", { name: "Remover filtro Vendedor: Ana" });
      expect(last(requests).filters).toEqual({ sellerCode: 7 });

      await fireEvent.press(screen.getByRole("button", { name: "Limpar filtros" }));
      expect(screen.queryByRole("button", { name: "Remover filtro Vendedor: Ana" })).toBeNull();
      expect(last(requests).filters).toEqual({});
      expect(await screen.findByText("2 clientes")).toBeTruthy();
    });

    it("hides the seller filter and the index when the repository cannot provide them", async () => {
      await render(<CustomersScreen customers={{ list: async () => pageOf([customer(1, { name: "Açúcar" })]) }} onUnauthenticated={noop} />);
      await screen.findByText("Açúcar");
      expect(screen.queryByRole("button", { name: "Índice alfabético" })).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
      expect(screen.queryByText("Vendedor")).toBeNull();
      expect(screen.getByText("Situação")).toBeTruthy();
    });

    it("says so when the filters match nobody", async () => {
      const customers: CustomerRepository = { list: async (request) => pageOf(request.filters?.status === "inactive" ? [] : [customer(1, { name: "Açúcar" })]) };
      await render(<CustomersScreen customers={customers} onUnauthenticated={noop} />);
      await screen.findByText("Açúcar");
      await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
      await fireEvent.press(screen.getByRole("radio", { name: "Inativos" }));
      await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
      expect(await screen.findByText("Nenhum cliente com estes filtros.")).toBeTruthy();
    });

    it("blames the search and the filters together when both match nobody", async () => {
      const customers: CustomerRepository = { list: async (request) => pageOf(request.filters?.status === "inactive" || request.search === "zzz" ? [] : [customer(1, { name: "Açúcar" })]) };
      await render(<CustomersScreen customers={customers} onUnauthenticated={noop} />);
      await screen.findByText("Açúcar");
      await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
      await fireEvent.press(screen.getByRole("radio", { name: "Inativos" }));
      await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
      await fireEvent.changeText(screen.getByPlaceholderText(/Buscar/), "zzz");
      expect(await screen.findByText("Nenhum cliente encontrado para “zzz” com estes filtros.")).toBeTruthy();
    });

    it("jumps to a letter through the index, disabling letters without customers, and # returns to the top", async () => {
      const requests: CustomerPageRequest[] = [];
      await render(<CustomersScreen customers={repo(requests)} onUnauthenticated={noop} />);
      await screen.findByText("Açúcar");
      await fireEvent.press(await screen.findByRole("button", { name: "Índice alfabético" }));
      expect(screen.getByRole("button", { name: "Letra C, sem clientes" }).props.accessibilityState.disabled).toBe(true);

      await fireEvent.press(screen.getByRole("button", { name: "Letra B, 1 cliente" }));
      await screen.findByText("Bar");
      expect(last(requests).startAt).toBe(1);

      await fireEvent.press(screen.getByRole("button", { name: "Índice alfabético" }));
      await fireEvent.press(screen.getByRole("button", { name: "Voltar ao início" }));
      expect(last(requests).startAt).toBe(0);
    });

    it("opens the ficha of the tapped customer", async () => {
      const onOpen = jest.fn();
      await render(<CustomersScreen customers={repo()} onUnauthenticated={noop} onOpen={onOpen} />);
      await fireEvent.press(await screen.findByRole("button", { name: /Açúcar, código 1/ }));
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ code: 1 }));
    });
  });
});
