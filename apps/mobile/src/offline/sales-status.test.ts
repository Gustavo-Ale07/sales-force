import type { DraftStatus } from "@salesforce/mobile-db";
import { draftRecord } from "../test-doubles";
import { CUSTOMER_BLOCK_MESSAGES, CUSTOMER_UNAVAILABLE_MESSAGE, PRODUCT_BLOCK_MESSAGES } from "@salesforce/mobile-db";
import { saleActionableExplanation, saleActions, saleBadge, saleExplanation, salesGroupOf, sendPhaseOf } from "./sales-status";

const ALL: DraftStatus[] = ["local_only", "pending_sync", "syncing", "synced", "sync_error", "conflict", "needs_review"];

describe("salesGroupOf", () => {
  it("only a synced order the server took for Sankhya (or with a Sankhya stage) is 'Enviados'; a saved draft copy is not", () => {
    expect(ALL.map((status) => [status, salesGroupOf({ status, sendState: "submitted" })])).toEqual([
      ["local_only", "unsent"],
      ["pending_sync", "unsent"],
      ["syncing", "unsent"],
      ["synced", "sent"],
      ["sync_error", "unsent"],
      ["conflict", "unsent"],
      ["needs_review", "unsent"],
    ]);
    expect(salesGroupOf({ status: "synced", sendState: null })).toBe("unsent");
    expect(salesGroupOf({ status: "synced", sendState: "requested" })).toBe("unsent");
  });

  it("same split as the server and the site: only `sent` is 'Enviados'; rejected, unknown, queued and the approval states are 'Não enviados', even with a Sankhya stage", () => {
    const group = (sendCode: string) => salesGroupOf({ status: "synced", sendState: "submitted", sendCode });
    expect(["rejected", "unknown", "queued", "awaiting_approval", "approved", "approval_rejected"].map(group)).toEqual(Array(6).fill("unsent"));
    expect(group("sent")).toBe("sent");
    expect(salesGroupOf({ status: "synced", sendState: "submitted", sendCode: "rejected", erpStage: { stage: "send_error" } as never })).toBe("unsent");
    expect(salesGroupOf({ status: "synced", sendState: "submitted", sendCode: "queued", erpStage: { stage: "sent_to_force" } as never })).toBe("unsent");
    expect(salesGroupOf({ status: "synced", sendState: "submitted", sendCode: "sent", erpStage: { stage: "in_review" } as never })).toBe("sent");
  });
});

describe("saleBadge", () => {
  it("an unconfirmed order (no send request) is 'Salvo no aparelho' in every neutral state, even once its draft copy synced; never 'Rascunho'", () => {
    const labels = ALL.map((status) => saleBadge(draftRecord({ status })).label);
    expect(labels).toEqual(["Salvo no aparelho", "Salvo no aparelho", "Salvo no aparelho", "Salvo no aparelho", "Erro", "Conflito", "Revisar preço"]);
    expect(labels.join(" ")).not.toMatch(/rascunho|em andamento|somente no aparelho/i);
    expect(saleBadge(draftRecord({ status: "synced" })).tone).toBe("neutral");
  });

  it("a confirmed order waiting to leave the device is 'Aguardando envio'", () => {
    expect(saleBadge(draftRecord({ status: "pending_sync", sendState: "requested" }))).toEqual({ label: "Aguardando envio", tone: "warning" });
    expect(saleBadge(draftRecord({ status: "synced", remoteId: "r1", sendState: "requested" })).label).toBe("Aguardando envio");
  });

  it("a definitively refused send is 'Precisa de correção' (no more 'Envio recusado')", () => {
    expect(saleBadge(draftRecord({ status: "synced", remoteId: "r1", sendState: "refused" }))).toEqual({ label: "Precisa de correção", tone: "danger" });
  });

  it.each([
    ["queued", "Enviado ao Sankhya", "ok"],
    ["sent", "Enviado ao Sankhya", "ok"],
    ["unknown", "Conferindo envio", "info"],
    ["awaiting_approval", "Aguardando aprovação", "warning"],
    ["approval_rejected", "Desconto reprovado", "danger"],
    ["approved", "Desconto aprovado", "info"],
  ] as const)("submitted with server code %s shows '%s'", (sendCode, label, tone) => {
    expect(saleBadge(draftRecord({ status: "synced", remoteId: "r1", sendState: "submitted", sendCode }))).toEqual({ label, tone });
  });

  it("marks errors, conflicts and price reviews as attention states", () => {
    expect(saleBadge(draftRecord({ status: "sync_error" })).tone).toBe("danger");
    expect(saleBadge(draftRecord({ status: "conflict" })).tone).toBe("danger");
    expect(saleBadge(draftRecord({ status: "needs_review" })).tone).toBe("warning");
  });
});

describe("sendPhaseOf", () => {
  it("maps the persisted send flag; null when the seller never confirmed", () => {
    expect(sendPhaseOf({ sendState: null })).toBeNull();
    expect(sendPhaseOf({ sendState: "requested" })).toBe("waiting");
    expect(sendPhaseOf({ sendState: "refused" })).toBe("refused");
    expect(sendPhaseOf({ sendState: "submitted", sendCode: "queued" })).toBe("in_sankhya");
    expect(sendPhaseOf({ sendState: "submitted", sendCode: "something-new" })).toBe("verifying");
  });
});

describe("saleExplanation", () => {
  it("has no passive status text; only an actionable send error", () => {
    expect(saleExplanation(draftRecord({ status: "local_only" }))).toBeNull();
    expect(saleExplanation(draftRecord({ status: "pending_sync", sendState: "requested" }))).toBeNull();
    expect(saleExplanation(draftRecord({ status: "synced", remoteId: "r1", sendState: "submitted", sendCode: "sent" }))).toBeNull();
    expect(saleExplanation(draftRecord({ status: "synced", remoteId: "r1", sendState: "refused", sendError: "Cliente sem vendedor." }))).toBeNull();
    expect(saleExplanation(draftRecord({ status: "sync_error", lastError: "O servidor recusou este pedido." }))).toMatch(/recusou/);
    expect(saleExplanation(draftRecord({ status: "conflict" }))).toBeNull();
    expect(saleExplanation(draftRecord({ status: "needs_review" }))).toBeNull();
    for (const status of ALL) expect(saleExplanation(draftRecord({ status })) ?? "").not.toMatch(/idempot|outbox|payload|HTTP|rascunho|\b[45]\d\d\b/i);
  });
});

describe("customer unavailable (held draft)", () => {
  const held = draftRecord({ status: "sync_error", lastError: CUSTOMER_UNAVAILABLE_MESSAGE });

  it("has its own badge and explanation, not the generic error", () => {
    expect(saleBadge(held)).toEqual({ label: "Cliente indisponível", tone: "warning" });
    expect(saleExplanation(held)).toContain("Cliente indisponível — revise o pedido");
    expect(saleExplanation(held)).toMatch(/não será enviado/i);
  });

  it("states the stored cause in the explanation", () => {
    const noSeller = draftRecord({ status: "sync_error", lastError: CUSTOMER_BLOCK_MESSAGES.customer_without_seller });
    expect(saleBadge(noSeller).label).toBe("Cliente indisponível");
    expect(saleExplanation(noSeller)).toContain("Este cliente não tem vendedor vinculado.");
    expect(saleExplanation(noSeller)).not.toMatch(/inativo ou bloqueado/);
    expect(saleActions(noSeller).resend).toBe(false);
  });

  it("blocks resending but still allows review (continue), copy and local delete of a never-sent draft", () => {
    expect(saleActions(held)).toEqual({ continue: true, duplicate: true, delete: true, resend: false, send: false });
  });

  it.each([PRODUCT_BLOCK_MESSAGES.product_without_mobility, PRODUCT_BLOCK_MESSAGES.product_without_price, PRODUCT_BLOCK_MESSAGES.product_unavailable, PRODUCT_BLOCK_MESSAGES.product_inactive])("a line that lost mobility or price ('%s'): own badge, reason stated, never offered for resending", (reason) => {
    const blocked = draftRecord({ status: "sync_error", lastError: reason });
    expect(saleBadge(blocked)).toEqual({ label: "Produto indisponível", tone: "warning" });
    expect(saleExplanation(blocked)).toContain(reason);
    expect(saleExplanation(blocked)).toMatch(/não será enviado/i);
    expect(saleActions(blocked)).toEqual({ continue: true, duplicate: true, delete: true, resend: false, send: false });
  });

  it("an ordinary error keeps its generic treatment", () => {
    expect(saleBadge(draftRecord({ status: "sync_error", lastError: "x" })).label).toBe("Erro");
    expect(saleActions(draftRecord({ status: "sync_error", lastError: "x" })).resend).toBe(true);
  });
});


describe("saleActions", () => {
  const A = (over: Parameters<typeof draftRecord>[0]) => saleActions(draftRecord(over));

  it("an unconfirmed, never-delivered order can be continued, duplicated, deleted and confirmed (send)", () => {
    expect(A({ status: "local_only" })).toEqual({ continue: true, duplicate: true, delete: true, resend: false, send: true });
    expect(A({ status: "pending_sync" })).toEqual({ continue: true, duplicate: true, delete: true, resend: false, send: true });
  });

  it("an errored order can be resent but not confirmed again from here", () => {
    expect(A({ status: "sync_error" })).toEqual({ continue: true, duplicate: true, delete: true, resend: true, send: false });
  });

  it("a confirmed order waiting to leave is blocked for editing and offers resend, not a second Confirmar", () => {
    expect(A({ status: "pending_sync", sendState: "requested" })).toMatchObject({ resend: true, send: false, continue: false });
  });

  it("a refused send offers Tentar de novo (send) and editing", () => {
    expect(A({ status: "synced", remoteId: "r1", sendState: "refused" })).toEqual({ continue: true, duplicate: true, delete: false, resend: false, send: true });
  });

  it.each(["queued", "sent", "unknown"])("read-only after confirm: submitted with code %s has no edit, delete, resend or send; only Duplicar", (sendCode) => {
    expect(A({ status: "synced", remoteId: "r1", sendState: "submitted", sendCode })).toEqual({ continue: false, duplicate: true, delete: false, resend: false, send: false });
  });

  it.each(["awaiting_approval", "approval_rejected"])("discount approval %s returns the order to editing but is never sent twice", (sendCode) => {
    expect(A({ status: "synced", remoteId: "r1", sendState: "submitted", sendCode })).toMatchObject({ continue: true, send: false, delete: false });
  });

  it("a saved order whose draft copy synced stays editable ('Salvo no aparelho'), not deletable, and can be confirmed and duplicated", () => {
    expect(A({ status: "synced", remoteId: "r1" })).toEqual({ continue: true, duplicate: true, delete: false, resend: false, send: true });
    const edited = A({ status: "pending_sync", remoteId: "r1" });
    expect(edited.delete).toBe(false);
    expect(edited.continue).toBe(true);
  });

  it("a held (customer/product unavailable) order is never offered send or resend", () => {
    const held = A({ status: "sync_error", lastError: CUSTOMER_UNAVAILABLE_MESSAGE, sendState: "refused" });
    expect(held.send).toBe(false);
    expect(held.resend).toBe(false);
  });

  it("does not allow deleting while the order is being sent", () => {
    expect(A({ status: "syncing" }).delete).toBe(false);
  });
});

describe("saleActionableExplanation", () => {
  it("is silent for every status and only states a seller-caused send failure", () => {
    expect(saleActionableExplanation(draftRecord({ status: "local_only" }))).toBeNull();
    expect(saleActionableExplanation(draftRecord({ status: "needs_review" }))).toBeNull();
    expect(saleActionableExplanation(draftRecord({ status: "conflict" }))).toBeNull();
  });
});

describe("rejected (Precisa de correção)", () => {
  const base = { status: "synced" as const, remoteId: "r1", sendState: "submitted" as const, sendCode: "rejected" };
  it("is labelled Precisa de correção and editable only without a Sankhya number", () => {
    const draft = draftRecord({ ...base, erpNumber: null });
    expect(saleBadge(draft)).toEqual({ label: "Precisa de correção", tone: "danger" });
    expect(saleActions(draft).continue).toBe(true);
    const numbered = draftRecord({ ...base, erpNumber: 123 });
    expect(saleBadge(numbered).label).toBe("Precisa de correção");
    expect(saleActions(numbered).continue).toBe(false);
  });

  it("shows no explanatory text, only the badge", () => {
    expect(saleExplanation(draftRecord({ ...base, sendError: "Frete não informado" }))).toBeNull();
    expect(saleExplanation(draftRecord({ ...base, sendError: null }))).toBeNull();
  });
});
