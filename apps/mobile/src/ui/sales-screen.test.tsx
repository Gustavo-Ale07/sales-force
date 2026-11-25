import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import type { DraftRecord, SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { EditorLine } from "../data/order-draft";
import type { LocalOrdersPort } from "../offline/local-orders";
import { customer, draftRecord, fakeLocalOrders, fakeProducts, pageOf, product } from "../test-doubles";
import { SalesScreen, type SalesScreenProps } from "./sales-screen";
import { renderWithModal } from "./test-modal-wrapper";

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

const ana = draftRecord({ localId: "a", customerCode: 1, customerName: "Ana Mercearia", status: "pending_sync", estimatedTotal: null, sendState: "requested" });
const bia = draftRecord({ localId: "b", customerCode: 2, customerName: "Bia Padaria", status: "sync_error", lastError: "Cliente bloqueado." });
const caio = draftRecord({ localId: "c", customerCode: 3, customerName: "Caio Atacado", status: "conflict" });
const dora = draftRecord({ localId: "d", customerCode: 4, customerName: "Dora Bar", status: "needs_review", priceReview: [{ productCode: 9, description: "Copo", cachedUnitPrice: "1.5", serverUnitPrice: "2", serverPriceJson: "{}" }] });
const eva = draftRecord({ localId: "e", customerCode: 5, customerName: "Eva Empório", status: "synced", remoteId: "r-e", remoteVersion: 1, remoteDraftNumber: 7, erpNumber: 77, estimatedTotal: "300.00", sendState: "submitted", sendCode: "sent" });
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
    products: fakeProducts({}),
    syncStatus: idle,
    connectivity: "online",
    onUnauthenticated: noop,
    onNewSale: jest.fn(),
    onContinue: jest.fn(),
    onDuplicate: jest.fn(),
    onSyncNow: jest.fn(),
    ...overrides,
  };
  const view = await renderWithModal(<SalesScreen {...props} />);
  return { props, localOrders, view };
}

/** Opens the DETAIL of a sale (long press: a tap on an editable sale goes straight to the wizard instead). */
async function openSale(name: RegExp) {
  await fireEvent(await screen.findByRole("button", { name }), "longPress");
  await screen.findByRole("button", { name: "Voltar para Vendas" });
}

/** Presses a button of the in-app dialog (replaces the native Alert). */
async function pressModal(label: string) {
  await fireEvent.press(await screen.findByRole("button", { name: label }));
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
    // Never confirmed: "Salvo no aparelho" (not "rascunho", not "Somente no aparelho").
    expect(screen.getByText("Salvo no aparelho")).toBeTruthy();
    expect(screen.queryByText(/rascunho|somente no aparelho/i)).toBeNull();
    expect(screen.queryByText("Eva Empório")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Novo pedido" }));
    expect(props.onNewSale).toHaveBeenCalledTimes(1);
  });

  it("'Enviados' lists only what the Force backend accepted, with its order number, value and the Sankhya send state, never the word ERP", async () => {
    await renderSales([ana, eva]);
    await fireEvent.press(await screen.findByRole("tab", { name: /Enviados/ }));
    expect(await screen.findByText("Eva Empório")).toBeTruthy();
    expect(screen.queryByText("Ana Mercearia")).toBeNull();
    expect(screen.getByText("Enviado ao Sankhya")).toBeTruthy();
    expect(screen.getByText(/Pedido nº 77/)).toBeTruthy();
    expect(screen.queryByText(/Force nº|nº 7$/)).toBeNull();
    expect(screen.getByText("R$ 300,00")).toBeTruthy();
    expect(screen.queryByText(/ERP/)).toBeNull();
  });

  it("an accepted order the seller never confirmed stays 'Salvo no aparelho' (no send request, no Sankhya claim)", async () => {
    const unconfirmed = draftRecord({ localId: "u", customerName: "Ugo Mercado", status: "synced", remoteId: "r-u", remoteDraftNumber: 5, estimatedTotal: "10.00" });
    await renderSales([unconfirmed]);
    expect(await screen.findByText("Salvo no aparelho")).toBeTruthy();
    expect(screen.getByText("Não enviados (1)")).toBeTruthy();
    expect(screen.queryByText(/Enviado ao Sankhya/)).toBeNull();
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

  it("filters by product: picks products from the device, shows a removable chip and the 'Período por' choice", async () => {
    const products = fakeProducts({ list: async () => pageOf([product(5, { description: "Copo 200 ml" })]) });
    await renderSales([ana, bia], { products });
    await screen.findByText("Ana Mercearia");
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Escolher produtos" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Copo 200 ml, código 5" }));
    expect(screen.getByText("1 de 20 selecionados")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Concluir seleção de produtos" }));
    await fireEvent.press(await screen.findByRole("radio", { name: "Hoje" }));
    expect(await screen.findByRole("radio", { name: "Última atualização" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByRole("button", { name: "Remover filtro 1 produto" })).toBeTruthy();
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
    expect(screen.getByText("Itens (2)")).toBeTruthy();
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getByText("Prato fundo")).toBeTruthy();
    expect(screen.getByText("Há itens sem preço: o valor é parcial.")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.queryByText(/estimado/i)).toBeNull();
  });

  it("closes an open detail when the shell signals a return to the list", async () => {
    const { props, view } = await renderSales([ana]);
    await openSale(/Ana Mercearia/);
    await view.rerender(<SalesScreen {...props} resetSignal={1} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Voltar para Vendas" })).toBeNull());
    expect(screen.getByRole("button", { name: /Ana Mercearia/ })).toBeTruthy();
  });

  it("a tap on a saved order ('Salvo no aparelho') opens the wizard at once; its card shows the action 'Editar'", async () => {
    const { props } = await renderSales([rascunho]);
    expect(await screen.findByText("Editar")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /Fábio Loja/ }));
    expect(props.onContinue).toHaveBeenCalledWith("f");
    expect(screen.queryByRole("button", { name: "Voltar para Vendas" })).toBeNull();
  });

  it("a tap on an order refused with a definitive error ('Precisa de correção') also opens the wizard", async () => {
    const refused = draftRecord({ localId: "r", customerName: "Rita Mercado", status: "synced", remoteId: "r-r", sendState: "refused", sendCode: "validation_failed", sendError: "Corrija o item." });
    const { props } = await renderSales([refused]);
    expect(await screen.findByText("Precisa de correção")).toBeTruthy();
    // The reason shows under the badge, as on the site.
    expect(screen.getByText("Corrija o item.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /Rita Mercado/ }));
    expect(props.onContinue).toHaveBeenCalledWith("r");
  });

  it("a sent order shows the release level text of the server under the badge", async () => {
    const waiting = draftRecord({ localId: "n", customerName: "Nina Mercado", status: "synced", remoteId: "r-n", sendState: "submitted", sendCode: "queued", erpStage: { stage: "in_review", label: "Em análise", pendingSector: null, nunota: 9, invoiceNumber: null, updatedAt: "2026-11-25T10:00:00.000Z", checkedAt: null, readError: null, releaseLevel: { state: "awaiting", level: 1, text: "Nível 1" } } });
    await renderSales([waiting]);
    expect(await screen.findByText("Nível 1")).toBeTruthy();
  });

  it("a rejected order delivered by the server shows its reason under the badge; an order without a reason shows none", async () => {
    const rejected = draftRecord({ localId: "j", customerName: "Joana Armazém", status: "synced", remoteId: "r-j", sendState: "submitted", sendCode: "rejected", sendError: "Produto sem preço na tabela." });
    const bare = draftRecord({ localId: "k", customerName: "Katia Depósito", status: "synced", remoteId: "r-k", sendState: "submitted", sendCode: "rejected" });
    await renderSales([rejected, bare]);
    expect(await screen.findByText("Produto sem preço na tabela.")).toBeTruthy();
    expect(screen.getAllByText("Precisa de correção").length).toBe(2);
  });

  it("a tap on a confirmed order ('Aguardando envio') opens it READ-ONLY: no wizard, no edit action", async () => {
    const { props } = await renderSales([ana]);
    await screen.findByText("Ana Mercearia");
    expect(screen.queryByText("Editar")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /Ana Mercearia/ }));
    await screen.findByRole("button", { name: "Voltar para Vendas" });
    expect(props.onContinue).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Editar pedido" })).toBeNull();
  });

  it("a tap on a sent order opens it read-only", async () => {
    const { props } = await renderSales([eva]);
    await fireEvent.press(await screen.findByRole("tab", { name: /Enviados/ }));
    await fireEvent.press(await screen.findByRole("button", { name: /Eva Empório/ }));
    await screen.findByRole("button", { name: "Voltar para Vendas" });
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it("the Vendas list shows no heading, no 'Atualizado' line and ONE entry: the 'Novo pedido' button", async () => {
    await renderSales([rascunho]);
    await screen.findByText("Fábio Loja");
    expect(screen.queryByText(/Atualizado/)).toBeNull();
    expect(screen.queryByText("Vendas")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Novo pedido" })).toHaveLength(1);
    expect(screen.getByText(/^1 venda/)).toBeTruthy();
  });

  it("duplicates through the shell without carrying any identifier of the original", async () => {
    const { props } = await renderSales([eva]);
    await fireEvent.press(await screen.findByRole("tab", { name: /Enviados/ }));
    await openSale(/Eva Empório/);
    expect(screen.queryByRole("button", { name: "Editar pedido" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Duplicar pedido" }));
    expect(props.onDuplicate).toHaveBeenCalledWith("e");
    expect(props.onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("deletes an unsent order only after an explicit confirmation, and it leaves the list", async () => {
    const { localOrders } = await renderSales([rascunho, ana]);
    await openSale(/Fábio Loja/);
    await fireEvent.press(screen.getByRole("button", { name: "Excluir pedido" }));
    expect(await screen.findByText("Excluir pedido?")).toBeTruthy();
    expect(screen.getByText(/removido deste aparelho e não será enviado/)).toBeTruthy();
    expect(localOrders.drafts).toHaveLength(2);
    await pressModal("Excluir");
    expect(localOrders.drafts.map((d) => d.localId)).toEqual(["a"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Voltar para Vendas" })).toBeNull());
    await waitFor(() => expect(screen.queryByText("Fábio Loja")).toBeNull());
  });

  it("keeps the order when the delete is cancelled", async () => {
    const { localOrders } = await renderSales([rascunho]);
    await openSale(/Fábio Loja/);
    await fireEvent.press(screen.getByRole("button", { name: "Excluir pedido" }));
    await pressModal("Cancelar");
    await waitFor(() => expect(screen.queryByText("Excluir pedido?")).toBeNull());
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
    expect(await screen.findByText("Salvo no aparelho")).toBeTruthy();
    await openSale(/Gil Depósito/);
    expect(screen.queryByRole("button", { name: "Excluir pedido" })).toBeNull();
  });

  it("explains a sending error in plain words; 'Tentar de novo' asks for the send and delivers it now (not a bare sync)", async () => {
    const requestSend = jest.fn(async (_id: string) => undefined);
    const confirm = jest.fn(async (_id: string) => ({ kind: "sent" as const, erpNumber: 123 }));
    const { props } = await renderSales([bia], {}, { requestSend, confirm });
    await openSale(/Bia Padaria/);
    expect(screen.getByText(/Não foi possível enviar este pedido\. Cliente bloqueado\./)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("b"));
    expect(requestSend).toHaveBeenCalledWith("b");
    expect(props.onSyncNow).not.toHaveBeenCalled();
  });

  it("offline: 'Tentar de novo' stays available, the answer is the 'não enviado' popup, and continue, duplicate and delete still work", async () => {
    const confirm = jest.fn(async (_id: string) => ({ kind: "queued" as const }));
    const { props } = await renderSales([bia], { connectivity: "offline" as ConnectivityState }, { confirm });
    await openSale(/Bia Padaria/);
    expect(screen.getByRole("button", { name: "Tentar de novo" }).props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Pedido não enviado ao Sankhya")).toBeTruthy();
    await pressModal("Fechar");
    await fireEvent.press(screen.getByRole("button", { name: "Editar pedido" }));
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
    expect(screen.getByText("Copo: R$ 1,50")).toBeTruthy();
    expect(screen.getByText("R$ 2,00")).toBeTruthy();
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
    localOrders.drafts[index] = { ...ana, status: "synced", remoteId: "r-a", remoteVersion: 1, remoteDraftNumber: 9, estimatedTotal: "50.00", sendState: "submitted", sendCode: "sent" };
    await view.rerender(<SalesScreen {...props} syncStatus={{ ...idle, lastSyncedAt: "2026-09-30T13:00:00.000Z" }} />);
    await waitFor(() => expect(screen.queryByText("Ana Mercearia")).toBeNull());
    expect(screen.getByText("Não enviados (0)")).toBeTruthy();
    expect(screen.getByText("Enviados (1)")).toBeTruthy();
    expect(screen.getByLabelText("Buscar venda").props.value).toBe("ana");
    await fireEvent.press(screen.getByRole("tab", { name: /Enviados/ }));
    const row = await screen.findByRole("button", { name: /Ana Mercearia/ });
    expect(within(row).getByText("Enviado ao Sankhya")).toBeTruthy();
    expect(screen.getAllByText("Ana Mercearia")).toHaveLength(1);
  });
});
