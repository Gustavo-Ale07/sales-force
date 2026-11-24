import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { colors } from "../theme";
import type { CustomerRepository, ProductRepository } from "../data/ports";
import { lineFromProduct } from "../data/order-draft";
import { customer, draftRecord, fakeLocalOrders, fakeOrders, fakeProducts, pageOf, product } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";
import { withModal } from "../test-render";
import { fillMandatoryHeader } from "./fill-mandatory-header";

async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

const QUESTION = "Esse desconto é acima do liberado. Tem certeza que deseja utilizar essa %?";
const priced = { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } as const;
const CODES = [4158, 4159, 1439, 1437, 3590];

function catalog(limit: string | null = "12", overrides: Record<number, string> = {}): ProductRepository {
  return fakeProducts({
    list: async () =>
      pageOf(
        CODES.map((code) =>
          product(code, { description: `Produto ${code}`, groupCode: code < 2000 ? 40 : 30, groupName: code < 2000 ? "Pratos" : "Copos", listPrice: priced, maxDiscountPercent: overrides[code] ?? limit }),
        ),
      ),
  });
}

async function cartWith(codes: number[], limit: string | null = "12", overrides: Record<number, string> = {}) {
  const customers: CustomerRepository = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
  await render(withModal(<NewOrderScreen repositories={{ customers, products: catalog(limit, overrides), orders: fakeOrders() }} onUnauthenticated={jest.fn()} />));
  await pressAndSettle(await screen.findByText("Padaria Central"));
  await fillMandatoryHeader();
  await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
  for (const code of codes) await pressAndSettle(await screen.findByRole("button", { name: `Adicionar Produto ${code} ao carrinho` }));
  await pressAndSettle(screen.getByRole("tab", { name: `Carrinho (${codes.length})` }));
}

const field = (code: number) => screen.getByLabelText(`Desconto de Produto ${code}`);
const valueOf = (code: number) => (field(code).props as { value: string }).value;

/** Types a discount and leaves the field, like the keyboard "done". */
async function typeDiscount(code: number, text: string) {
  await act(async () => {
    fireEvent.changeText(field(code), text);
  });
  await act(async () => {
    fireEvent(field(code), "endEditing");
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 100));
  });
}

async function bulk(text: string, target?: string) {
  await pressAndSettle(screen.getByRole("button", { name: "Desconto em lote" }));
  if (target !== undefined) await pressAndSettle(screen.getByRole("radio", { name: target }));
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText("Desconto (%)"), text);
  });
  await pressAndSettle(screen.getByRole("button", { name: "Aplicar desconto" }));
}

describe("discount above the product limit: per item", () => {
  it("shows 'Máx. 12%' and no warning while the discount is within the limit", async () => {
    await cartWith([4158]);
    expect(screen.getByText("Máx. 12%")).toBeTruthy();
    await typeDiscount(4158, "10");
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(valueOf(4158)).toBe("10");
  });

  it("asks once above the limit; Sim keeps the typed value", async () => {
    await cartWith([4158]);
    await typeDiscount(4158, "15");
    expect(await screen.findByText(QUESTION)).toBeTruthy();
    await pressAndSettle(screen.getByRole("button", { name: "Sim" }));
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(valueOf(4158)).toBe("15");
  });

  it("highlights an over-limit discount in amber and clears it within the limit", async () => {
    await cartWith([4158]);
    const border = () => (StyleSheet.flatten(field(4158).props.style as never) as { borderColor?: string }).borderColor;
    await typeDiscount(4158, "10");
    expect(border()).not.toBe(colors.amberBorder);
    await typeDiscount(4158, "15");
    await pressAndSettle(await screen.findByRole("button", { name: "Sim" }));
    expect(border()).toBe(colors.amberBorder);
  });

  it("Não restores the previous value", async () => {
    await cartWith([4158]);
    await typeDiscount(4158, "10");
    await typeDiscount(4158, "15");
    await pressAndSettle(await screen.findByRole("button", { name: "Não" }));
    expect(valueOf(4158)).toBe("10");
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it("does not ask again in the order after the first Sim (another item)", async () => {
    await cartWith([4158, 4159]);
    await typeDiscount(4158, "15");
    await pressAndSettle(await screen.findByRole("button", { name: "Sim" }));
    await typeDiscount(4159, "20");
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(valueOf(4159)).toBe("20");
  });

  it("does not ask for a product without a registered limit", async () => {
    await cartWith([4158], null);
    expect(screen.queryByText(/Máx\./)).toBeNull();
    await typeDiscount(4158, "50");
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(valueOf(4158)).toBe("50");
  });

  it("does not block Próximo or Confirmar after accepting", async () => {
    await cartWith([4158]);
    await typeDiscount(4158, "15");
    await pressAndSettle(await screen.findByRole("button", { name: "Sim" }));
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByLabelText("Etapa 4 de 4: Resumo")).toBeTruthy();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar" }).props.accessibilityState?.disabled).not.toBe(true);
  });
});

describe("discount above the product limit: bulk and group", () => {
  it("asks once with the count and the list; Sim applies to all as typed", async () => {
    await cartWith(CODES);
    await bulk("15");
    expect(await screen.findByText(QUESTION)).toBeTruthy();
    expect(screen.getByText("Acima do limite (5)")).toBeTruthy();
    expect(screen.getByText("Dentro do limite (0)")).toBeTruthy();
    expect(screen.getByText("Produto 4158: máx. 12%, digitado 15%")).toBeTruthy();
    // one sheet only: the form is replaced by the question, no second dialog
    expect(screen.queryByTestId("app-modal-details")).toBeNull();
    expect(screen.queryByLabelText("Desconto (%)")).toBeNull();
    for (const code of CODES) expect(valueOf(code)).toBe("");
    await pressAndSettle(screen.getByRole("button", { name: "Sim" }));
    for (const code of CODES) expect(valueOf(code)).toBe("15");
  });

  it("Não cancels the whole operation", async () => {
    await cartWith(CODES);
    await bulk("15");
    await pressAndSettle(await screen.findByRole("button", { name: "Não" }));
    for (const code of CODES) expect(valueOf(code)).toBe("");
  });

  it("counts the items within the limit when only some exceed it", async () => {
    await cartWith(CODES, "12", { 3590: "20" });
    await bulk("15");
    expect(await screen.findByText("Acima do limite (4)")).toBeTruthy();
    expect(screen.getByText("Dentro do limite (1)")).toBeTruthy();
    expect(within(screen.getByTestId("bulk-discount-confirm")).getByText("Produto 3590")).toBeTruthy();
    expect(screen.queryByText(/Produto 3590: máx/)).toBeNull();
    await pressAndSettle(screen.getByRole("button", { name: "Sim" }));
    for (const code of CODES) expect(valueOf(code)).toBe("15");
  });

  it("applies without asking when every item stays within the limit", async () => {
    await cartWith(CODES);
    await bulk("10");
    expect(screen.queryByText(QUESTION)).toBeNull();
    for (const code of CODES) expect(valueOf(code)).toBe("10");
  });

  it("does not warn without a registered limit", async () => {
    await cartWith(CODES, null);
    await bulk("40");
    expect(screen.queryByText(QUESTION)).toBeNull();
    for (const code of CODES) expect(valueOf(code)).toBe("40");
  });

  it("asks once per group apply, then never again after Sim (group then item)", async () => {
    await cartWith(CODES);
    await bulk("15", "Pratos");
    expect(await screen.findByText(QUESTION)).toBeTruthy();
    await pressAndSettle(screen.getByRole("button", { name: "Sim" }));
    expect(valueOf(1439)).toBe("15");
    expect(valueOf(1437)).toBe("15");
    expect(valueOf(4158)).toBe("");
    await typeDiscount(4158, "30");
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(valueOf(4158)).toBe("30");
  });

  it("does not ask for a bulk apply after an item Sim (item then bulk)", async () => {
    await cartWith(CODES);
    await typeDiscount(4158, "15");
    await pressAndSettle(await screen.findByRole("button", { name: "Sim" }));
    await bulk("20");
    expect(screen.queryByText(QUESTION)).toBeNull();
    for (const code of CODES) expect(valueOf(code)).toBe("20");
  });

  it("does not ask for an item after a bulk Sim (bulk then item)", async () => {
    await cartWith(CODES);
    await bulk("15");
    await pressAndSettle(await screen.findByRole("button", { name: "Sim" }));
    await typeDiscount(4159, "18");
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(valueOf(4159)).toBe("18");
  });
});

describe("discount above the product limit: reopened order", () => {
  it("does not ask again when the saved order is already marked", async () => {
    const line = { ...lineFromProduct(product(4158, { description: "Produto 4158", listPrice: priced, maxDiscountPercent: "12" }), "k1"), discountText: "15" };
    const saved = draftRecord({ localId: "d1", customerCode: 10, customerName: "Padaria Central", discountOverLimitAccepted: true, itemCount: 1 });
    const localOrders = fakeLocalOrders([saved], { open: async () => ({ draft: saved, lines: [line] }) });
    const customers: CustomerRepository = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
    await render(
      withModal(
        <NewOrderScreen repositories={{ customers, products: catalog(), orders: fakeOrders() }} localOrders={localOrders} resumeLocalId="d1" onUnauthenticated={jest.fn()} />,
      ),
    );
    await waitFor(() => expect(screen.getByLabelText("Etapa 4 de 4: Resumo")).toBeTruthy());
    expect(screen.queryByText(QUESTION)).toBeNull();
    await pressAndSettle(screen.getByRole("button", { name: "Editar produtos" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    expect(screen.getByText("Máx. 12%")).toBeTruthy();
    await typeDiscount(4158, "20");
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(valueOf(4158)).toBe("20");
  });
});
