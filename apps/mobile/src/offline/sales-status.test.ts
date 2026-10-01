import type { DraftStatus } from "@salesforce/mobile-db";
import { draftRecord } from "../test-doubles";
import { CUSTOMER_UNAVAILABLE_MESSAGE } from "@salesforce/mobile-db";
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
  it("uses seller wording for each real state; a synced order is \"Enviado ao Force\", never an ERP state", () => {
    const labels = ALL.map((status) => saleBadge(draftRecord({ status })).label);
    expect(labels).toEqual(["Rascunho", "Aguardando envio", "Sincronizando", "Enviado ao Force", "Erro", "Conflito", "Revisar preço"]);
    // The device does not carry any ERP stage (awaiting / synced / confirmed / invoiced): no label may claim one.
    expect(labels.join(" ")).not.toMatch(/ERP|Sankhya|faturad|confirmad|sincronizado com/i);
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
    const synced = saleExplanation(draftRecord({ status: "synced", remoteId: "r1" }));
    expect(synced).toMatch(/enviado ao Force/i);
    expect(synced).not.toMatch(/faturad|confirmad|sincronizado com o ERP/i);
    expect(saleExplanation(draftRecord({ status: "sync_error", lastError: "O servidor recusou este pedido." }))).toMatch(/recusou/);
    expect(saleExplanation(draftRecord({ status: "conflict" }))).toMatch(/nada foi sobrescrito/i);
    expect(saleExplanation(draftRecord({ status: "needs_review" }))).toMatch(/preços mudaram/i);
    for (const status of ALL) expect(saleExplanation(draftRecord({ status }))).not.toMatch(/idempot|outbox|payload|HTTP|\b[45]\d\d\b/i);
  });
});

describe("customer unavailable (held draft)", () => {
  const held = draftRecord({ status: "sync_error", lastError: CUSTOMER_UNAVAILABLE_MESSAGE });

  it("has its own badge and explanation, not the generic error", () => {
    expect(saleBadge(held)).toEqual({ label: "Cliente indisponível", tone: "warning" });
    expect(saleExplanation(held)).toContain("Cliente indisponível — revise o rascunho");
    expect(saleExplanation(held)).toMatch(/não será enviado/i);
  });

  it("blocks resending but still allows review (continue), copy and local delete of a never-sent draft", () => {
    expect(saleActions(held)).toEqual({ continue: true, duplicate: true, delete: true, resend: false });
  });

  it("an ordinary error keeps its generic treatment", () => {
    expect(saleBadge(draftRecord({ status: "sync_error", lastError: "x" })).label).toBe("Erro");
    expect(saleActions(draftRecord({ status: "sync_error", lastError: "x" })).resend).toBe(true);
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
