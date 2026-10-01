import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { DraftDiscardError, type DraftItemRecord, type QuarantinedDraftDetail, type QuarantinedDraftRecord } from "@salesforce/mobile-db";
import type { LocalOrdersPort } from "../offline/local-orders";
import { draftRecord, fakeLocalOrders } from "../test-doubles";
import { QuarantineScreen } from "./quarantine-screen";

function retained(localId: string, name: string, overrides: Partial<QuarantinedDraftRecord> = {}): QuarantinedDraftRecord {
  return {
    draft: draftRecord({ localId, customerName: name, customerCode: 10, createdAt: "2026-09-01T15:30:00.000Z", itemCount: 3, dataset: null, eligibility: "legacy_local", status: "needs_review" }),
    reason: "legacy_local",
    canDiscard: true,
    ...overrides,
  };
}

const items: DraftItemRecord[] = [
  { position: 1, productCode: 1, description: "Copo 200 ml", unit: "UN", quantity: "4", discountPercent: "0", priceJson: "{}", groupCode: null, groupName: null },
  { position: 2, productCode: 2, description: "Prato fundo", unit: "CX", quantity: "1", discountPercent: "5", priceJson: "{}", groupCode: null, groupName: null },
];

function setup(list: QuarantinedDraftRecord[], overrides: Partial<LocalOrdersPort> = {}) {
  let current = [...list];
  const discardQuarantined = jest.fn(async (localId: string) => {
    current = current.filter((entry) => entry.draft.localId !== localId);
  });
  const localOrders = fakeLocalOrders([], {
    listQuarantined: async () => current,
    countQuarantined: async () => current.length,
    openQuarantined: async (localId): Promise<QuarantinedDraftDetail | null> => {
      const record = current.find((entry) => entry.draft.localId === localId);
      return record === undefined ? null : { record, items };
    },
    discardQuarantined,
    ...overrides,
  });
  const onBack = jest.fn();
  const onChanged = jest.fn();
  return { localOrders, onBack, onChanged, discardQuarantined, ...{ render: () => render(<QuarantineScreen localOrders={localOrders} onBack={onBack} onChanged={onChanged} />) } };
}

function acceptAlert(label: string) {
  return jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((button) => button.text === label)?.onPress?.();
  });
}

describe("QuarantineScreen", () => {
  it("explains the section and lists each retained order with customer, date, item count and the plain reason", async () => {
    const ctx = setup([retained("a", "Padaria Central"), retained("b", "Mercado Sul")]);
    await ctx.render();
    expect(await screen.findByText("Pedidos antigos retidos")).toBeTruthy();
    expect(screen.getByText(/não são enviados ao Force/)).toBeTruthy();
    expect(screen.getByText("Padaria Central")).toBeTruthy();
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
    expect(screen.getAllByText("3 itens").length).toBe(2);
    expect(screen.getAllByText(/Criado em 01\/09\/2026/).length).toBe(2);
    expect(screen.getAllByText("Criado antes da verificação de dados; não será enviado ao Force.").length).toBe(2);
  });

  it("offers no convert, resend or retry action anywhere", async () => {
    const ctx = setup([retained("a", "Padaria Central")]);
    await ctx.render();
    await fireEvent.press(await screen.findByRole("button", { name: /Ver pedido retido de Padaria Central/ }));
    await screen.findByText("Copo 200 ml");
    expect(screen.queryByText(/enviar novamente|reenviar|converter|continuar|tentar/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /enviar|converter|continuar|tentar/i })).toBeNull();
  });

  it("shows the empty state", async () => {
    const ctx = setup([]);
    await ctx.render();
    expect(await screen.findByText("Nenhum pedido retido neste aparelho.")).toBeTruthy();
  });

  it("opens a read-only detail with the items", async () => {
    const ctx = setup([retained("a", "Padaria Central")]);
    await ctx.render();
    await fireEvent.press(await screen.findByRole("button", { name: /Ver pedido retido de Padaria Central/ }));
    expect(await screen.findByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getByText("4 UN")).toBeTruthy();
    expect(screen.getByText("Prato fundo")).toBeTruthy();
    expect(screen.getByText("Criado antes da verificação de dados; não será enviado ao Force.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Voltar para pedidos retidos" }));
    expect(await screen.findByText("Padaria Central")).toBeTruthy();
  });

  it("discards only after an explicit confirmation, locally, and updates the list", async () => {
    const ctx = setup([retained("a", "Padaria Central"), retained("b", "Mercado Sul")]);
    await ctx.render();
    await fireEvent.press(await screen.findByRole("button", { name: /Ver pedido retido de Padaria Central/ }));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await fireEvent.press(await screen.findByRole("button", { name: "Descartar pedido retido" }));
    expect(alert).toHaveBeenCalledWith("Descartar pedido?", expect.stringMatching(/removido deste aparelho.*não será enviado ao Force.*não pode ser desfeita/), expect.any(Array));
    expect(ctx.discardQuarantined).not.toHaveBeenCalled(); // nothing happens until confirmed
    alert.mockRestore();

    acceptAlert("Descartar");
    await fireEvent.press(screen.getByRole("button", { name: "Descartar pedido retido" }));
    await waitFor(() => expect(ctx.discardQuarantined).toHaveBeenCalledWith("a"));
    expect(ctx.onChanged).toHaveBeenCalled();
    expect(await screen.findByText("Mercado Sul")).toBeTruthy();
    expect(screen.queryByText("Padaria Central")).toBeNull();
  });

  it("cancelling the confirmation keeps the order", async () => {
    const ctx = setup([retained("a", "Padaria Central")]);
    await ctx.render();
    await fireEvent.press(await screen.findByRole("button", { name: /Ver pedido retido de Padaria Central/ }));
    acceptAlert("Cancelar");
    await fireEvent.press(await screen.findByRole("button", { name: "Descartar pedido retido" }));
    expect(ctx.discardQuarantined).not.toHaveBeenCalled();
  });

  it("does not offer discard for an order that may already be on the server, and says why", async () => {
    const ctx = setup([retained("a", "Padaria Central", { canDiscard: false })]);
    await ctx.render();
    await fireEvent.press(await screen.findByRole("button", { name: /Ver pedido retido de Padaria Central/ }));
    expect(await screen.findByText(/pode já ter chegado ao Force/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Descartar pedido retido" })).toBeNull();
  });

  it("reports a refused discard instead of failing silently", async () => {
    const ctx = setup([retained("a", "Padaria Central")], {
      discardQuarantined: async () => {
        throw new DraftDiscardError("Este pedido já foi enviado ao servidor e não pode ser descartado aqui.");
      },
    });
    await ctx.render();
    await fireEvent.press(await screen.findByRole("button", { name: /Ver pedido retido de Padaria Central/ }));
    const alert = jest.spyOn(Alert, "alert").mockImplementation((title, _message, buttons?: AlertButton[]) => {
      if (title === "Descartar pedido?") buttons?.find((button) => button.text === "Descartar")?.onPress?.();
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Descartar pedido retido" }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Não foi possível descartar", expect.stringContaining("não pode ser descartado")));
    alert.mockRestore();
  });

  it("goes back", async () => {
    const ctx = setup([retained("a", "Padaria Central")]);
    await ctx.render();
    await fireEvent.press(await screen.findByRole("button", { name: "Voltar" }));
    expect(ctx.onBack).toHaveBeenCalled();
  });
});
