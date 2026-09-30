import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import type { DraftRecord, SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { EditorLine } from "../data/order-draft";
import type { LocalOrdersPort } from "../offline/local-orders";
import { customer, draftRecord, fakeLocalOrders, pageOf } from "../test-doubles";
import { SalesScreen, type SalesScreenProps } from "./sales-screen";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

function line(code: number, description: string, unitPrice: string | null, quantityText = "2", discountText = ""): EditorLine {
  return {
    key: `k${code}`,
    productCode: code,
    description,
    unit: "UN",
    quantityText,
    discountText,
    price: unitPrice === null ? { state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" } : { state: "priced", unitPrice, tableCode: 1, versionId: 1 },
  };
}

const ana = draftRecord({ localId: "a", customerCode: 1, customerName: "Ana Mercearia", status: "pending_sync", estimatedTotal: null });
const bia = draftRecord({ localId: "b", customerCode: 2, customerName: "Bia Padaria", status: "sync_error", lastError: "Cliente bloqueado." });
const caio = draftRecord({ localId: "c", customerCode: 3, customerName: "Caio Atacado", status: "conflict" });
const dora = draftRecord({ localId: "d", customerCode: 4, customerName: "Dora Bar", status: "needs_review", priceReview: [{ productCode: 9, description: "Copo", cachedUnitPrice: "1.5", serverUnitPrice: "2", serverPriceJson: "{}" }] });
const eva = draftRecord({ localId: "e", customerCode: 5, customerName: "Eva Empório", status: "synced", remoteId: "r-e", remoteVersion: 1, remoteDraftNumber: 77, estimatedTotal: "300.00" });
const rascunho = draftRecord({ localId: "f", customerCode: 6, customerName: "Fábio Loja", status: "local_only" });

const noop = () => undefined;

async function renderSales(drafts: DraftRecord[], overrides: Partial<SalesScreenProps> = {}, portOverrides: Partial<LocalOrdersPort> = {}) {
  const localOrders = fakeLocalOrders(drafts, {
    open: async (localId) => {
      const found = drafts.find((d) => d.localId === localId);
      return found === undefined ? null : { draft: found, lines: [line(1, "Copo 200 ml", "10.00"), line(2, "Prato fundo", null, "1")] };
    },
    ...portOverrides,
  });
  const props: SalesScreenProps = {
    localOrders,
    customers: { list: async () => pageOf([customer(1, { name: "Ana Mercearia" }), customer(2, { name: "Bia Padaria" })]) },
    syncStatus: idle,
    connectivity: "online",
    onUnauthenticated: noop,
    onNewSale: jest.fn(),
    onContinue: jest.fn(),
    onDuplicate: jest.fn(),
    onSyncNow: jest.fn(),
    ...overrides,
  };
  const view = await render(<SalesScreen {...props} />);
  return { props, localOrders, view };
}

async function openSale(name: RegExp) {
  await fireEvent.press(await screen.findByRole("button", { name }));
  await screen.findByRole("button", { name: "Voltar para Vendas" });
}

/** Presses the named button of the last Alert. */
function pressAlert(spy: jest.SpyInstance, text: string) {
  const buttons = spy.mock.calls.at(-1)?.[2] as AlertButton[];
  const button = buttons.find((b) => b.text === text);
  if (button === undefined) throw new Error(`no alert button ${text}`);
  return act(async () => {
    await button.onPress?.();
  });
}

afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
  });
});

describe("SalesScreen — groups", () => {
  it("shows 'Não enviados' first with real counters, badges and the new-sale CTA", async () => {
    const { props } = await renderSales([ana, bia, caio, dora, eva, rascunho]);
    expect(await screen.findByText("Ana Mercearia")).toBeTruthy();
    expect(screen.getByText("Não enviados (5)")).toBeTruthy();
    expect(screen.getByText("Enviados (1)")).toBeTruthy();
    expect(screen.getByText("Aguardando envio")).toBeTruthy();
    expect(screen.getByText("Erro")).toBeTruthy();
    expect(screen.getByText("Conflito")).toBeTruthy();
    expect(screen.getByText("Revisar preço")).toBeTruthy();
    expect(screen.getByText("Rascunho")).toBeTruthy();
    expect(screen.queryByText("Eva Empório")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Nova venda" }));
    expect(props.onNewSale).toHaveBeenCalledTimes(1);
  });

  it("'Enviados' lists only what the Force backend accepted, with its order number and value, and says nothing about the ERP", async () => {
    await renderSales([ana, eva]);
    await fireEvent.press(await screen.findByRole("tab", { name: /Enviados/ }));
    expect(await screen.findByText("Eva Empório")).toBeTruthy();
    expect(screen.queryByText("Ana Mercearia")).toBeNull();
    expect(screen.getByText("Sincronizado")).toBeTruthy();
    expect(screen.getByText(/Pedido nº 77/)).toBeTruthy();
    expect(screen.getByText("R$ 300,00")).toBeTruthy();
    expect(screen.queryByText(/ERP|Sankhya/)).toBeNull();
  });

  it("explains an empty group", async () => {
    await renderSales([eva]);
    expect(await screen.findByText("Nenhuma venda pendente.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("tab", { name: /Enviados/ }));
    expect(await screen.findByText("Eva Empório")).toBeTruthy();
  });

  it("does not show the other accounts' sales or fake documents", async () => {
    await renderSales([]);
    expect(await screen.findByText("Nenhuma venda pendente.")).toBeTruthy();
    expect(screen.queryByText(/Orçamento|Nota fiscal/)).toBeNull();
  });
});

describe("SalesScreen — search and filters", () => {
  it("searches by customer and explains a search without results, without dangerous fuzzy matching", async () => {
    await renderSales([ana, bia]);
    await screen.findByText("Ana Mercearia");
    await fireEvent.changeText(screen.getByLabelText("Buscar venda"), "bia");
    expect(await screen.findByText("Bia Padaria")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Ana Mercearia")).toBeNull());
    await fireEvent.changeText(screen.getByLabelText("Buscar venda"), "zzz");
    expect(await screen.findByText("Nenhuma venda encontrada para “zzz”.")).toBeTruthy();
  });

  it("filters by status, shows a removable chip, and the counters follow the filter", async () => {
    await renderSales([ana, bia, caio]);
    await screen.findByText("Ana Mercearia");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(await screen.findByRole("radio", { name: "Erro" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("Bia Padaria")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Ana Mercearia")).toBeNull());
    expect(screen.getByText("Não enviados (1)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filtros, 1 ativo(s)" })).toBeTruthy();
  });

  it("combines status and search, and says when the combination finds nothing", async () => {
    await renderSales([ana, bia, caio]);
    await screen.findByText("Ana Mercearia");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(await screen.findByRole("radio", { name: "Erro" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    await fireEvent.changeText(screen.getByLabelText("Buscar venda"), "ana");
    expect(await screen.findByText("Nenhuma venda encontrada para “ana”.")).toBeTruthy();
  });

  it("switching to 'Enviados' drops status filters that only exist for unsent orders", async () => {
    await renderSales([bia, eva]);
    await screen.findByText("Bia Padaria");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(await screen.findByRole("radio", { name: "Erro" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    await fireEvent.press(await screen.findByRole("tab", { name: /Enviados/ }));
    expect(await screen.findByText("Eva Empório")).toBeTruthy();
  });
});

describe("SalesScreen — detail and actions", () => {
  it("opens the detail with status explanation, items, discounts and totals from the domain", async () => {
    await renderSales([ana]);
    await openSale(/Ana Mercearia/);
    expect(screen.getByText(/salvo neste aparelho e será enviado ao Force/)).toBeTruthy();
    expect(screen.getByText("Itens (2)")).toBeTruthy();
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getByText("Prato fundo")).toBeTruthy();
    expect(screen.getByText("Há itens sem preço: o valor é parcial.")).toBeTruthy();
    expect(screen.getByText("Valor estimado")).toBeTruthy();
  });

  it("closes an open detail when the shell signals a return to the list", async () => {
    const { props, view } = await renderSales([ana]);
    await openSale(/Ana Mercearia/);
    await view.rerender(<SalesScreen {...props} resetSignal={1} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Voltar para Vendas" })).toBeNull());
    expect(screen.getByRole("button", { name: /Ana Mercearia/ })).toBeTruthy();
  });

  it("continues an unsent order", async () => {
    const { props } = await renderSales([ana]);
    await openSale(/Ana Mercearia/);
    await fireEvent.press(screen.getByRole("button", { name: "Continuar pedido" }));
    expect(props.onContinue).toHaveBeenCalledWith("a");
  });

  it("duplicates through the shell without carrying any identifier of the original", async () => {
    const { props } = await renderSales([eva]);
    await fireEvent.press(await screen.findByRole("tab", { name: /Enviados/ }));
    await openSale(/Eva Empório/);
    expect(screen.queryByRole("button", { name: "Continuar pedido" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Duplicar pedido" }));
    expect(props.onDuplicate).toHaveBeenCalledWith("e");
    expect(props.onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("deletes an unsent order only after an explicit confirmation, and it leaves the list", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { localOrders } = await renderSales([rascunho, ana]);
    await openSale(/Fábio Loja/);
    await fireEvent.press(screen.getByRole("button", { name: "Excluir pedido" }));
    expect(alert.mock.calls.at(-1)?.[0]).toBe("Excluir rascunho?");
    expect(alert.mock.calls.at(-1)?.[1]).toMatch(/removido deste aparelho e não será enviado/);
    expect(localOrders.drafts).toHaveLength(2);
    await pressAlert(alert, "Excluir");
    expect(localOrders.drafts.map((d) => d.localId)).toEqual(["a"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Voltar para Vendas" })).toBeNull());
    await waitFor(() => expect(screen.queryByText("Fábio Loja")).toBeNull());
  });

  it("keeps the order when the delete is cancelled", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { localOrders } = await renderSales([rascunho]);
    await openSale(/Fábio Loja/);
    await fireEvent.press(screen.getByRole("button", { name: "Excluir pedido" }));
    await pressAlert(alert, "Cancelar");
    expect(localOrders.drafts).toHaveLength(1);
  });

  it("never offers to delete an order the Force backend already has", async () => {
    await renderSales([eva]);
    await fireEvent.press(await screen.findByRole("tab", { name: /Enviados/ }));
    await openSale(/Eva Empório/);
    expect(screen.queryByRole("button", { name: "Excluir pedido" })).toBeNull();
    expect(screen.getByText(/não podem ser excluídos por aqui/)).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
  });

  it("a pending change on a synced order is an unsent edit and cannot be deleted", async () => {
    const edited = draftRecord({ localId: "g", customerName: "Gil Depósito", status: "pending_sync", remoteId: "r-g", remoteVersion: 2 });
    await renderSales([edited]);
    expect(await screen.findByText("Alteração aguardando envio")).toBeTruthy();
    await openSale(/Gil Depósito/);
    expect(screen.queryByRole("button", { name: "Excluir pedido" })).toBeNull();
  });

  it("explains a sending error in plain words and retries only when online", async () => {
    const { props } = await renderSales([bia]);
    await openSale(/Bia Padaria/);
    expect(screen.getByText(/Não foi possível enviar este pedido\. Cliente bloqueado\./)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Tentar enviar novamente" }));
    expect(props.onSyncNow).toHaveBeenCalledTimes(1);
  });

  it("offline: the retry is disabled with an explanation, while continue, duplicate and delete still work", async () => {
    const { props } = await renderSales([bia], { connectivity: "offline" as ConnectivityState });
    expect(await screen.findByText(/dados salvos neste aparelho/)).toBeTruthy();
    await openSale(/Bia Padaria/);
    expect(screen.getByRole("button", { name: "Tentar enviar novamente" }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/O envio acontece sozinho quando a internet voltar/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Continuar pedido" }));
    expect(props.onContinue).toHaveBeenCalledWith("b");
    expect(screen.getByRole("button", { name: "Duplicar pedido" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Excluir pedido" })).toBeTruthy();
  });

  it("conflict: reuses the existing resolution, never a second engine, and needs a connection", async () => {
    const resolveConflict = jest.fn(async (_id: string, _resolution: string) => undefined);
    await renderSales([caio], {}, { resolveConflict });
    await openSale(/Caio Atacado/);
    expect(screen.getByText("Este pedido foi alterado em outro lugar. Nada foi sobrescrito.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Manter minha versão" }));
    expect(resolveConflict).toHaveBeenCalledWith("c", "keep_local");
    await fireEvent.press(screen.getByRole("button", { name: "Usar a versão do servidor" }));
    expect(resolveConflict).toHaveBeenCalledWith("c", "use_server");
  });

  it("conflict offline: the resolution is disabled and says why", async () => {
    await renderSales([caio], { connectivity: "offline" as ConnectivityState });
    await openSale(/Caio Atacado/);
    expect(screen.getByRole("button", { name: "Manter minha versão" }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("Conecte-se à internet para escolher qual versão manter.")).toBeTruthy();
  });

  it("price review: shows the old and new price and accepts them locally", async () => {
    const acknowledge = jest.fn(async (_id: string) => undefined);
    await renderSales([dora], {}, { acknowledgePriceReview: acknowledge });
    await openSale(/Dora Bar/);
    expect(screen.getByText(/Copo: R\$ 1,50 → R\$ 2,00/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Aceitar novos preços" }));
    expect(acknowledge).toHaveBeenCalledWith("d");
  });

  it("an order that vanished from the device says so instead of crashing", async () => {
    await renderSales([ana], {}, { open: async () => null });
    await fireEvent.press(await screen.findByRole("button", { name: /Ana Mercearia/ }));
    expect(await screen.findByText("Esta venda não está mais neste aparelho.")).toBeTruthy();
  });
});

describe("SalesScreen — reconnection", () => {
  it("reflects a finished delivery without a new order and keeps the tab and search", async () => {
    const { view, props, localOrders } = await renderSales([ana]);
    await fireEvent.changeText(screen.getByLabelText("Buscar venda"), "ana");
    expect(await screen.findByText("Aguardando envio")).toBeTruthy();
    // The sync manager delivered the order: it is now synced, and the status object changes.
    const index = localOrders.drafts.findIndex((d) => d.localId === "a");
    localOrders.drafts[index] = { ...ana, status: "synced", remoteId: "r-a", remoteVersion: 1, remoteDraftNumber: 9, estimatedTotal: "50.00" };
    await view.rerender(<SalesScreen {...props} syncStatus={{ ...idle, lastSyncedAt: "2026-09-30T13:00:00.000Z" }} />);
    await waitFor(() => expect(screen.queryByText("Ana Mercearia")).toBeNull());
    expect(screen.getByText("Não enviados (0)")).toBeTruthy();
    expect(screen.getByText("Enviados (1)")).toBeTruthy();
    expect(screen.getByLabelText("Buscar venda").props.value).toBe("ana");
    await fireEvent.press(screen.getByRole("tab", { name: /Enviados/ }));
    const row = await screen.findByRole("button", { name: /Ana Mercearia/ });
    expect(within(row).getByText("Sincronizado")).toBeTruthy();
    expect(screen.getAllByText("Ana Mercearia")).toHaveLength(1);
  });
});
