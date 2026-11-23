import { createRef, type MutableRefObject } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { customer, draftRecord, fakeLocalOrders, fakeOrders, fakeProducts, orderEntryConfiguration, pageOf, product } from "../test-doubles";
import { NewOrderScreen, type NewOrderControl, type NewOrderScreenProps } from "./new-order-screen";
import type { LocalOrdersPort } from "../offline/local-orders";
import { withModal } from "../test-render";
import { fillMandatoryHeader } from "./fill-mandatory-header";

async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}
async function settle(delayMs = 100) {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}
afterEach(async () => {
  jest.restoreAllMocks();
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

const dialog = (title: string) => within(screen.getByLabelText(title));
const copo = product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } });

function setup(overrides: Partial<LocalOrdersPort> = {}, props: Partial<NewOrderScreenProps> = {}) {
  const saved = draftRecord({ localId: "saved-1" });
  const save = jest.fn(async (input: { recovery?: boolean }) => draftRecord({ localId: "L1", kind: input.recovery === true ? "recovery" : "saved" }));
  const discardRecovery = jest.fn(async () => undefined);
  const localOrders = fakeLocalOrders([saved], { save: save as unknown as LocalOrdersPort["save"], discardRecovery, ...overrides });
  const onExit = jest.fn();
  const controlRef: MutableRefObject<NewOrderControl | null> = createRef<NewOrderControl | null>() as MutableRefObject<NewOrderControl | null>;
  controlRef.current = null;
  const element = (
    <NewOrderScreen
      repositories={{
        customers: { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) },
        products: fakeProducts({ list: async () => pageOf([copo]) }),
        orders: fakeOrders({ getEntryConfiguration: async () => orderEntryConfiguration() }),
      }}
      onUnauthenticated={() => undefined}
      localOrders={localOrders}
      onExit={onExit}
      controlRef={controlRef}
      {...props}
    />
  );
  return { element: withModal(element), save, discardRecovery, onExit, controlRef };
}

async function withCustomerOnly(ctx: ReturnType<typeof setup>) {
  await render(ctx.element);
  await settle();
  await pressAndSettle(await screen.findByText("Padaria Central"));
}

async function withOneItem(ctx: ReturnType<typeof setup>) {
  await withCustomerOnly(ctx);
  await fillMandatoryHeader();
  await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
  await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
}

describe("leaving a new order that was not saved", () => {
  it("asks ONCE with the three buttons, whatever path leaves (X, then Back/tab through the control)", async () => {
    const ctx = setup();
    await withOneItem(ctx);
    await pressAndSettle(screen.getByLabelText("Sair do pedido"));
    expect(screen.getAllByLabelText("Descartar o pedido?")).toHaveLength(1);
    const popup = dialog("Descartar o pedido?");
    expect(popup.getByRole("button", { name: "Salvar e sair" })).toBeTruthy();
    expect(popup.getByRole("button", { name: "Descartar" })).toBeTruthy();
    expect(popup.getByRole("button", { name: "Continuar editando" })).toBeTruthy();
    // a second path while the popup is open does not stack another
    await act(async () => {
      await ctx.controlRef.current?.requestLeave();
    });
    expect(screen.getAllByLabelText("Descartar o pedido?")).toHaveLength(1);
    expect(ctx.onExit).not.toHaveBeenCalled();
  });

  it("'Continuar editando' keeps the order and does not leave", async () => {
    const ctx = setup();
    await withOneItem(ctx);
    await pressAndSettle(screen.getByLabelText("Sair do pedido"));
    await pressAndSettle(dialog("Descartar o pedido?").getByRole("button", { name: "Continuar editando" }));
    expect(ctx.onExit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Descartar o pedido?")).toBeNull();
    expect(screen.getByRole("tab", { name: /Carrinho \(1\)/ })).toBeTruthy();
  });

  it("'Salvar e sair' creates the SAVED order (not a recovery) and leaves", async () => {
    const ctx = setup();
    await withOneItem(ctx);
    ctx.save.mockClear();
    await pressAndSettle(screen.getByLabelText("Sair do pedido"));
    await pressAndSettle(dialog("Descartar o pedido?").getByRole("button", { name: "Salvar e sair" }));
    await settle();
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.save.mock.calls[0]?.[0]?.recovery).toBeUndefined();
    expect(ctx.onExit).toHaveBeenCalledTimes(1);
  });

  it("'Descartar' deletes the recovery record, saves nothing and leaves", async () => {
    const ctx = setup();
    await withOneItem(ctx);
    ctx.save.mockClear();
    await pressAndSettle(screen.getByLabelText("Sair do pedido"));
    await pressAndSettle(dialog("Descartar o pedido?").getByRole("button", { name: "Descartar" }));
    await settle();
    expect(ctx.discardRecovery).toHaveBeenCalledTimes(1);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.onExit).toHaveBeenCalledTimes(1);
  });

  it("an empty order leaves with no question and writes nothing", async () => {
    const ctx = setup();
    await render(ctx.element);
    await settle();
    await pressAndSettle(screen.getByLabelText("Sair do pedido"));
    expect(screen.queryByLabelText("Descartar o pedido?")).toBeNull();
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.onExit).toHaveBeenCalledTimes(1);
  });

  it("a customer alone already counts as content", async () => {
    const ctx = setup();
    await withCustomerOnly(ctx);
    await pressAndSettle(screen.getByLabelText("Sair do pedido"));
    expect(screen.getByLabelText("Descartar o pedido?")).toBeTruthy();
  });

  it("Back on a step after the first only goes back one step, without a question", async () => {
    const ctx = setup();
    await withCustomerOnly(ctx);
    expect(screen.getByLabelText(/^Etapa 2 de 4/)).toBeTruthy();
    await act(async () => {
      ctx.controlRef.current?.back();
    });
    await settle();
    expect(screen.queryByLabelText("Descartar o pedido?")).toBeNull();
    expect(screen.getByLabelText(/^Etapa 1 de 4/)).toBeTruthy();
    expect(ctx.onExit).not.toHaveBeenCalled();
  });

  it("autosave between steps writes ONLY a recovery record", async () => {
    const ctx = setup();
    await withOneItem(ctx);
    await pressAndSettle(screen.getByRole("tab", { name: /Carrinho/ }));
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    expect(ctx.save).toHaveBeenCalled();
    for (const call of ctx.save.mock.calls) expect(call[0]?.recovery).toBe(true);
  });
});

describe("entering with a recovery record", () => {
  const recovered = draftRecord({ localId: "rec-1", kind: "recovery", customerCode: 10, customerName: "Padaria Central" });

  it("asks once 'Continuar o pedido em andamento?' and 'Continuar' restores it", async () => {
    const ctx = setup({ getRecovery: async () => ({ draft: recovered, lines: [] }) });
    await render(ctx.element);
    await settle();
    expect(screen.getAllByLabelText("Continuar o pedido em andamento?")).toHaveLength(1);
    await pressAndSettle(dialog("Continuar o pedido em andamento?").getByRole("button", { name: "Continuar" }));
    await settle();
    expect(screen.queryByLabelText("Continuar o pedido em andamento?")).toBeNull();
    expect(screen.getAllByText("Padaria Central").length).toBeGreaterThan(0);
    // still never saved on purpose: leaving asks
    await pressAndSettle(screen.getByLabelText("Sair do pedido"));
    expect(screen.getByLabelText("Descartar o pedido?")).toBeTruthy();
  });

  it("'Descartar' deletes the record and starts an empty order", async () => {
    const ctx = setup({ getRecovery: async () => ({ draft: recovered, lines: [] }) });
    await render(ctx.element);
    await settle();
    await pressAndSettle(dialog("Continuar o pedido em andamento?").getByRole("button", { name: "Descartar" }));
    await settle();
    expect(ctx.discardRecovery).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Selecione o cliente")).toBeTruthy();
  });

  it("asks nothing when there is no recovery record", async () => {
    const ctx = setup();
    await render(ctx.element);
    await settle();
    expect(screen.queryByLabelText("Continuar o pedido em andamento?")).toBeNull();
  });
});
