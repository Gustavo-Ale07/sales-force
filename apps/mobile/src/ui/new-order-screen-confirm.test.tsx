import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ConfirmOutcome } from "@salesforce/mobile-db";
import type { LocalOrdersPort } from "../offline/local-orders";
import { customer, draftRecord, fakeLocalOrders, fakeOrders, fakeProducts, orderEntryConfiguration, pageOf, product } from "../test-doubles";
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

const copo = product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } });
const base = orderEntryConfiguration();
const config = orderEntryConfiguration({ sales: { ...base.sales, orderTops: { defaultTopCode: 1001, quotationTopCode: 1000, eligibleTopCodes: [1000, 1001] } } });

/** Walks the wizard to the summary with a local store whose confirm answers `outcome`; returns the spies. */
async function toSummary(
  outcome: ConfirmOutcome | (() => Promise<ConfirmOutcome>),
  quotation = false,
  extra: { readOrderNumber?: (id: string) => Promise<number | null>; navigation?: boolean } = {},
) {
  const saved = draftRecord({ localId: "l1", status: "pending_sync", sendState: "requested", topCode: quotation ? 1000 : 1001 });
  const save = jest.fn(async () => saved);
  const confirm = jest.fn(typeof outcome === "function" ? outcome : async () => outcome);
  const requestSend = jest.fn(async (_id: string) => undefined);
  const exit = jest.fn();
  const viewOrder = jest.fn();
  const goHome = jest.fn();
  const localOrders: LocalOrdersPort = fakeLocalOrders([saved], {
    save: save as never,
    confirm,
    requestSend,
    get: async () => saved,
    ...(extra.readOrderNumber === undefined ? {} : { readOrderNumber: extra.readOrderNumber }),
  });
  const repositories = {
    customers: { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) },
    products: fakeProducts({ list: async () => pageOf([copo]) }),
    orders: fakeOrders({ getEntryConfiguration: async () => config, listCarriers: async () => [{ code: 7, name: "Transportes Alfa" }] }),
  };
  await render(
    withModal(
      <NewOrderScreen
        repositories={repositories}
        onUnauthenticated={() => undefined}
        localOrders={localOrders}
        onExit={exit}
        {...(extra.navigation === true ? { onViewOrder: viewOrder, onGoHome: goHome } : {})}
      />,
    ),
  );
  await pressAndSettle(await screen.findByText("Padaria Central"));
  if (quotation) await pressAndSettle(screen.getByRole("radio", { name: "Operação Orçamento (TOP 1000)" }));
  await fillMandatoryHeader();
  await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
  await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
  await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
  return { save, confirm, requestSend, exit, viewOrder, goHome, savesBefore: () => save.mock.calls.length };
}

const confirmButton = () => screen.getByRole("button", { name: "Confirmar" });

describe("NewOrderScreen Confirmar (local path)", () => {
  it("ends with TWO buttons: 'Confirmar' (primary) and 'Salvar e sair'; no 'Salvar rascunho/pedido/orçamento' and no 'Enviar'", async () => {
    await toSummary({ kind: "sent", erpNumber: 1 });
    expect(screen.getAllByRole("button", { name: "Confirmar" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Salvar e sair" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Salvar (rascunho|pedido|orçamento)/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Enviar/ })).toBeNull();
  });

  it("'Salvar e sair' keeps the order on the device and leaves: it never asks Sankhya and never writes a send request", async () => {
    const { save, confirm, requestSend, exit } = await toSummary({ kind: "sent", erpNumber: 1 });
    save.mockClear();
    await pressAndSettle(screen.getByRole("button", { name: "Salvar e sair" }));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(requestSend).not.toHaveBeenCalled();
    // Whatever is saved on the way out carries no send request.
    for (const call of save.mock.calls as unknown as Array<[{ sendRequested?: boolean }]>) expect(call[0].sendRequested).not.toBe(true);
    expect(screen.queryByText("Pedido enviado")).toBeNull();
    expect(screen.queryByText(/não enviado ao Sankhya/)).toBeNull();
  });

  it("the header X does exactly 'Salvar e sair': no question, never Sankhya", async () => {
    const { confirm, requestSend, exit } = await toSummary({ kind: "sent", erpNumber: 1 });
    await pressAndSettle(screen.getByRole("button", { name: "Sair do pedido" }));
    expect(screen.queryByText("Sair do pedido?")).toBeNull();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(requestSend).not.toHaveBeenCalled();
  });

  it("saves with the send request, delivers it, and an order that reached Sankhya shows 'Pedido enviado' and its number, read-only", async () => {
    const { save, confirm } = await toSummary({ kind: "sent", erpNumber: 4321 });
    const before = save.mock.calls.length; // the wizard auto-saves while moving between steps
    await pressAndSettle(confirmButton());
    expect(save.mock.calls.length - before).toBe(1);
    expect(confirm).toHaveBeenCalledWith("l1");
    expect(await screen.findByText("Pedido enviado")).toBeTruthy();
    expect(screen.getByText("Pedido nº 4321")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar pedido" })).toBeNull();
    expect(screen.getByRole("button", { name: "Novo pedido" })).toBeTruthy();
  });

  it("post-confirmation buttons: 'Ver pedido' opens that order, 'Voltar ao início' goes home, 'Novo pedido' starts over", async () => {
    const { viewOrder, goHome } = await toSummary({ kind: "sent", erpNumber: 4321 }, false, { navigation: true });
    await pressAndSettle(confirmButton());
    await pressAndSettle(await screen.findByRole("button", { name: "Ver pedido" }));
    expect(viewOrder).toHaveBeenCalledWith("l1");
    await pressAndSettle(screen.getByRole("button", { name: "Voltar ao início" }));
    expect(goHome).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Novo pedido" })).toBeTruthy();
  });

  describe("number follow-up while the screen is open", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    async function confirmWithFakeTimers(read: (id: string) => Promise<number | null>) {
      const ctx = await toSummary({ kind: "sending" }, false, { readOrderNumber: read });
      jest.useFakeTimers();
      await act(async () => {
        fireEvent.press(confirmButton());
        await jest.advanceTimersByTimeAsync(10);
      });
      return ctx;
    }

    it("asks again with growing intervals and shows 'Pedido enviado' and the number as soon as it arrives", async () => {
      const read = jest.fn<Promise<number | null>, [string]>(async () => null);
      await confirmWithFakeTimers(read);
      expect(screen.getByText("Enviando ao Sankhya")).toBeTruthy();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_600);
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Pedido enviado")).toBeNull();
      read.mockResolvedValue(2511);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2_200);
      });
      expect(screen.getByText("Pedido enviado")).toBeTruthy();
      expect(screen.getByText("Pedido nº 2511")).toBeTruthy();
      const calls = read.mock.calls.length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20_000);
      });
      expect(read.mock.calls.length).toBe(calls);
    });

    it("after the budget it settles into the neutral 'aguardando envio' state, not an error", async () => {
      const read = jest.fn<Promise<number | null>, [string]>(async () => null);
      await confirmWithFakeTimers(read);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(70_000);
      });
      expect(screen.getByText("Pedido aguardando envio")).toBeTruthy();
      expect(screen.queryByText("Enviando ao Sankhya")).toBeNull();
      expect(screen.queryByText(/erro|falh/i)).toBeNull();
    });

    it("stops asking when the screen unmounts", async () => {
      const read = jest.fn<Promise<number | null>, [string]>(async () => null);
      await confirmWithFakeTimers(read);
      await act(async () => {
        screen.unmount();
      });
      const calls = read.mock.calls.length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      // one last read on the way out is allowed; nothing after it
      expect(read.mock.calls.length - calls).toBeLessThanOrEqual(0);
    });
  });

  it("a quotation says 'Orçamento enviado', following the configured quotation TOP", async () => {
    await toSummary({ kind: "sent", erpNumber: 7 }, true);
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Orçamento enviado")).toBeTruthy();
    expect(screen.queryByText("Pedido enviado")).toBeNull();
  });

  it("offline / queued: the popup says it was not sent to Sankhya, the order is 'aguardando envio' and BLOCKED for editing", async () => {
    await toSummary({ kind: "queued" });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Pedido não enviado ao Sankhya")).toBeTruthy();
    expect(screen.getByText("O pedido ficou salvo neste aparelho e será enviado assim que possível.")).toBeTruthy();
    expect(screen.getByText("Pedido aguardando envio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar pedido" })).toBeNull();
  });

  it("Sankhya down (503): the standard popup 'Sankhya indisponível' with 'Tentar de novo'; the order stays queued and blocked", async () => {
    await toSummary({ kind: "queued", reason: "sankhya_unavailable" });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Sankhya indisponível")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(screen.queryByText("Erro ao sincronizar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar pedido" })).toBeNull();
  });

  it("a quotation that is queued uses the quotation words", async () => {
    await toSummary({ kind: "queued" }, true);
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Orçamento não enviado ao Sankhya")).toBeTruthy();
    expect(screen.getByText("O orçamento ficou salvo neste aparelho e será enviado assim que possível.")).toBeTruthy();
  });

  it("still sending after the wait: 'Enviando ao Sankhya', read-only", async () => {
    await toSummary({ kind: "sending" });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Enviando ao Sankhya")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar pedido" })).toBeNull();
  });

  it("awaiting a manager's discount approval is its own state, not 'enviado'", async () => {
    await toSummary({ kind: "awaiting_approval" });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Aguardando aprovação")).toBeTruthy();
    expect(screen.queryByText("Pedido enviado")).toBeNull();
  });

  it("a confirm that throws is treated as queued: the order is saved and nothing is lost", async () => {
    await toSummary(async () => {
      throw new Error("network down");
    });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Pedido não enviado ao Sankhya")).toBeTruthy();
  });

  it("a double tap on Confirmar saves and delivers once", async () => {
    const { save, confirm } = await toSummary(() => new Promise<ConfirmOutcome>((resolve) => setTimeout(() => resolve({ kind: "sent", erpNumber: 9 }), 150)));
    const button = confirmButton();
    const before = save.mock.calls.length;
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
    });
    expect(save.mock.calls.length - before).toBe(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe("NewOrderScreen Confirmar: definitive refusals (popup with the fix, no resend loop)", () => {
  it("customer without seller (5020): popup 'Cliente sem vendedor' with 'Trocar cliente'; one delivery attempt only", async () => {
    const { confirm } = await toSummary({ kind: "refused", code: "customer_without_seller", message: null });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Cliente sem vendedor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trocar cliente" })).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    expect(confirm).toHaveBeenCalledTimes(1);
    await pressAndSettle(screen.getByRole("button", { name: "Trocar cliente" }));
    expect(screen.getByLabelText("Etapa 1 de 4: Cliente")).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("discount_blocked: popup 'Desconto bloqueado' leading back to the items", async () => {
    await toSummary({ kind: "refused", code: "discount_blocked", message: null });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Desconto bloqueado")).toBeTruthy();
    await pressAndSettle(screen.getByRole("button", { name: "Revisar itens" }));
    expect(screen.getByLabelText("Etapa 3 de 4: Produtos")).toBeTruthy();
  });

  it("erp_submission_disabled: popup 'Envio ao Sankhya desligado', the order stays saved", async () => {
    await toSummary({ kind: "refused", code: "erp_submission_disabled", message: null });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Envio ao Sankhya desligado")).toBeTruthy();
    expect(screen.getByText(/nada foi enviado/)).toBeTruthy();
    expect(screen.queryByText("Pedido enviado")).toBeNull();
  });

  it("header_not_eligible: popup with the server's text and a way back to the negotiation step", async () => {
    await toSummary({ kind: "refused", code: "header_not_eligible", message: "A transportadora não está mais disponível." });
    await pressAndSettle(confirmButton());
    expect(await screen.findByText("Operação indisponível")).toBeTruthy();
    expect(screen.getByText("A transportadora não está mais disponível.")).toBeTruthy();
  });
});
