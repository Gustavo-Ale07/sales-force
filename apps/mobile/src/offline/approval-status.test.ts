import { approvalViewOf } from "./approval-status";

const decided = (decision: "approved" | "rejected", comment: string | null) => ({
  requestedLevel: "manager" as const,
  requestedAt: "2026-10-01T10:00:00.000Z",
  decision,
  decidedAt: "2026-10-01T11:00:00.000Z",
  decidedByName: "Marina Gerente",
  comment,
});

describe("approvalViewOf (M-14)", () => {
  it("shows nothing for an ordinary draft or an order sent on", () => {
    expect(approvalViewOf({ status: "draft", approval: null })).toBeNull();
    expect(approvalViewOf({ status: "sent", approval: null })).toBeNull();
  });

  it("names the level an order is waiting for", () => {
    const view = approvalViewOf({ status: "awaiting_approval", approval: { ...decided("approved", null), decision: "pending", decidedAt: null, decidedByName: null, requestedLevel: "director" } });
    expect(view?.title).toBe("Aguardando aprovação do desconto");
    expect(view?.lines.join(" ")).toContain("Diretoria");
  });

  it("shows who approved and the comment", () => {
    const view = approvalViewOf({ status: "approved", approval: decided("approved", "Cliente estratégico") });
    expect(view?.tone).toBe("ok");
    expect(view?.lines).toContain("Decidido por Marina Gerente.");
    expect(view?.lines).toContain("Comentário: Cliente estratégico");
  });

  it("shows the rejection with the mandatory comment and never claims an ERP outcome", () => {
    const view = approvalViewOf({ status: "approval_rejected", approval: decided("rejected", "Desconto alto demais") });
    expect(view?.tone).toBe("danger");
    expect(view?.lines.join(" ")).toContain("Desconto alto demais");
    expect(view?.lines.join(" ")).not.toMatch(/ERP/);
  });
});
