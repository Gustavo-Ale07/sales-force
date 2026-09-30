import type { DraftStatus } from "@salesforce/mobile-db";
import { draftRecord } from "../test-doubles";
import { saleActions, saleBadge, saleExplanation, salesGroupOf } from "./sales-status";

const ALL: DraftStatus[] = ["local_only", "pending_sync", "syncing", "synced", "sync_error", "conflict", "needs_review"];

describe("salesGroupOf", () => {
  it("maps every status: only synced is 'Enviados' (accepted by the Force backend, not the ERP)", () => {
    expect(ALL.map((status) => [status, salesGroupOf(status)])).toEqual([
      ["local_only", "unsent"],
      ["pending_sync", "unsent"],
      ["syncing", "unsent"],
      ["synced", "sent"],
      ["sync_error", "unsent"],
      ["conflict", "unsent"],
      ["needs_review", "unsent"],
    ]);
  });
});

describe("saleBadge", () => {
  it("uses seller wording for each real state and never mentions the ERP", () => {
    const labels = ALL.map((status) => saleBadge(draftRecord({ status })).label);
    expect(labels).toEqual(["Rascunho", "Aguardando envio", "Sincronizando", "Sincronizado", "Erro", "Conflito", "Revisar preço"]);
    expect(labels.join(" ")).not.toMatch(/ERP|Sankhya/i);
  });

  it("says when an already-synced order has a change waiting to be sent", () => {
    expect(saleBadge(draftRecord({ status: "pending_sync", remoteId: "r1" })).label).toBe("Alteração aguardando envio");
  });

  it("marks errors, conflicts and price reviews as attention states", () => {
    expect(saleBadge(draftRecord({ status: "sync_error" })).tone).toBe("danger");
    expect(saleBadge(draftRecord({ status: "conflict" })).tone).toBe("danger");
    expect(saleBadge(draftRecord({ status: "needs_review" })).tone).toBe("warning");
    expect(saleBadge(draftRecord({ status: "synced" })).tone).toBe("ok");
  });
});

describe("saleExplanation", () => {
  it("states where the order is, without technical jargon", () => {
    expect(saleExplanation(draftRecord({ status: "local_only" }))).toMatch(/somente neste aparelho/i);
    expect(saleExplanation(draftRecord({ status: "pending_sync" }))).toMatch(/será enviado/i);
    expect(saleExplanation(draftRecord({ status: "synced", remoteId: "r1" }))).toMatch(/sincronizado com o Force/i);
    expect(saleExplanation(draftRecord({ status: "sync_error", lastError: "O servidor recusou este pedido." }))).toMatch(/recusou/);
    expect(saleExplanation(draftRecord({ status: "conflict" }))).toMatch(/nada foi sobrescrito/i);
    expect(saleExplanation(draftRecord({ status: "needs_review" }))).toMatch(/preços mudaram/i);
    for (const status of ALL) expect(saleExplanation(draftRecord({ status }))).not.toMatch(/idempot|outbox|payload|HTTP|\b[45]\d\d\b/i);
  });
});

describe("saleActions", () => {
  it("lets an unsent, never-delivered order be continued, duplicated, deleted and resent", () => {
    expect(saleActions(draftRecord({ status: "sync_error" }))).toEqual({ continue: true, duplicate: true, delete: true, resend: true });
    expect(saleActions(draftRecord({ status: "pending_sync" }))).toEqual({ continue: true, duplicate: true, delete: true, resend: true });
  });

  it("never offers deleting or editing an order the Force backend already holds", () => {
    const synced = saleActions(draftRecord({ status: "synced", remoteId: "r1" }));
    expect(synced).toEqual({ continue: false, duplicate: true, delete: false, resend: false });
    const edited = saleActions(draftRecord({ status: "pending_sync", remoteId: "r1" }));
    expect(edited.delete).toBe(false);
    expect(edited.continue).toBe(true);
  });

  it("does not allow deleting while the order is being sent", () => {
    expect(saleActions(draftRecord({ status: "syncing" })).delete).toBe(false);
  });
});
