import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ORDER_STAGE_LABELS, ORDER_STAGE_TIMELINE } from "@salesforce/domain";
import type { DraftErpStage } from "@salesforce/mobile-db";
import { STAGE_FILTER_OPTIONS, erpStageViewOf } from "../offline/erp-stage";
import { draftRecord, fakeLocalOrders } from "../test-doubles";
import { ErpStageCard } from "./erp-stage-card";
import { SaleDetailScreen } from "./sale-detail-screen";
import { renderWithModal } from "./test-modal-wrapper";

const NOW = "2026-11-20T13:30:00.000Z";
const stage = (code: string, label: string, extra: Partial<DraftErpStage> = {}): DraftErpStage => ({
  stage: code,
  label,
  pendingSector: null,
  nunota: null,
  invoiceNumber: null,
  updatedAt: NOW,
  checkedAt: NOW,
  readError: null,
  ...extra,
});
const view = (s: DraftErpStage) => {
  const v = erpStageViewOf(s);
  if (v === null) throw new Error("no view");
  return v;
};

const TIMELINE = ORDER_STAGE_TIMELINE.map((code) => [code, ORDER_STAGE_LABELS[code]] as const);

describe("ErpStageCard per stage", () => {
  it.each(TIMELINE.map((entry, index) => ({ code: entry[0], label: entry[1], index })))("$code: earlier steps concluded, this one current, later ones next", async ({ code, label, index }) => {
    await render(<ErpStageCard stage={view(stage(code, label, { nunota: 555 }))} />);
    const labels = TIMELINE.map((entry) => entry[1]);
    labels.forEach((text, position) => {
      const state = position < index ? "concluída" : position === index ? "etapa atual" : "próxima etapa";
      expect(screen.getByLabelText(`${text}, ${state}`)).toBeTruthy();
    });
    expect(screen.getByText("Pedido nº 555")).toBeTruthy();
    expect(screen.getByText(`Situação no Sankhya: ${label} · atualizado em 20/11/2026 10:30`)).toBeTruthy();
  });

  it("concluded steps show a vector check (no text glyph), the others their number", async () => {
    await render(<ErpStageCard stage={view(stage("financial_check", "Análise financeira", { pendingSector: "Financeiro" }))} />);
    expect(screen.queryByText("✓")).toBeNull();
    // The two concluded steps carry the vector check instead of their number; the others keep theirs.
    expect(screen.queryByText("1")).toBeNull();
    expect(screen.queryByText("2")).toBeNull();
    for (const n of ["3", "4", "5", "6"]) expect(screen.getByText(n)).toBeTruthy();
    expect(screen.getByText("Pendente no setor: Financeiro")).toBeTruthy();
  });

  it("invoiced shows the invoice number", async () => {
    await render(<ErpStageCard stage={view(stage("invoiced", "Faturado", { nunota: 9, invoiceNumber: 321 }))} />);
    expect(screen.getByText("Nota fiscal nº 321")).toBeTruthy();
  });

  it("barred is a red (danger) stage with no timeline and is offered by the stage filter", () => {
    const barred = view(stage("barred", ORDER_STAGE_LABELS.barred, { nunota: 5 }));
    expect(barred).toMatchObject({ tone: "danger", kind: "force", steps: [] });
    expect(STAGE_FILTER_OPTIONS).toContainEqual({ value: "barred", label: "Barrado" });
  });

  it("a quotation shows its number and no timeline", async () => {
    await render(<ErpStageCard stage={view(stage("quotation", "Orçamento", { nunota: 77 }))} />);
    expect(screen.getByText("Orçamento nº 77")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("a Force-side state has no timeline and no Sankhya number", async () => {
    await render(<ErpStageCard stage={view(stage("sent_to_force", "Enviado ao Force"))} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/Sankhya nº/)).toBeNull();
  });
});

describe("SaleDetailScreen stage read failure", () => {
  const noop = () => undefined;
  const failing = draftRecord({
    localId: "x",
    status: "synced",
    remoteId: "r-x",
    remoteDraftNumber: 9,
    sendState: "submitted",
    sendCode: "sent",
    erpStage: stage("in_review", "Em análise", { readError: { errorClass: "unavailable", errorCode: "x", at: NOW } }),
  });

  it("announces the failure ONCE with 'Tentar de novo' that runs a sync, and keeps the last known stage on screen", async () => {
    const onSyncNow = jest.fn();
    const localOrders = fakeLocalOrders([failing], { open: async () => ({ draft: failing, lines: [] }) });
    const { rerender } = await renderWithModal(<SaleDetailScreen localId="x" localOrders={localOrders} connectivity="online" onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={onSyncNow} />);
    expect(await screen.findByText("Sankhya indisponível")).toBeTruthy();
    expect(screen.getByText(/Situação no Sankhya: Em análise/)).toBeTruthy();
    // Dismiss, re-render the same data: the popup does not come back.
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Fechar" }));
    });
    await act(async () => {
      rerender(<SaleDetailScreen localId="x" localOrders={localOrders} connectivity="online" onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={onSyncNow} />);
    });
    expect(screen.queryByText("Sankhya indisponível")).toBeNull();
  });

  it("'Tentar de novo' on that popup asks for a synchronization", async () => {
    const onSyncNow = jest.fn();
    const localOrders = fakeLocalOrders([failing], { open: async () => ({ draft: failing, lines: [] }) });
    await renderWithModal(<SaleDetailScreen localId="x" localOrders={localOrders} connectivity="online" onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={onSyncNow} />);
    await screen.findByText("Sankhya indisponível");
    fireEvent.press(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(onSyncNow).toHaveBeenCalledTimes(1));
  });
});
