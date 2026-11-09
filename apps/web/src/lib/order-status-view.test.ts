import { describe, expect, it } from "vitest";
import { orderStatusLabels, orderStatusView } from "./labels";

describe("orderStatusView (D-AA)", () => {
  const updatedAt = "2026-11-05T15:00:00.000Z";
  const at = (s: number) => Date.parse(updatedAt) + s * 1000;

  it("reads Enviando while a delivery is recent and Aguardando envio after 2 minutes", () => {
    expect(orderStatusView({ status: "queued", updatedAt }, at(30)).label).toBe("Enviando ao Sankhya…");
    const late = orderStatusView({ status: "queued", updatedAt }, at(150));
    expect(late.label).toBe("Aguardando envio — será reenviado automaticamente");
    expect(`${late.label} ${late.hint}`).not.toMatch(/fila/i);
  });

  it("leaves other statuses untouched", () => {
    expect(orderStatusView({ status: "rejected", updatedAt }, at(9999)).label).toBe("Falha no envio");
  });

  it("colours by state: sent is green, in progress is blue, failures are red, long waits and approvals are amber", () => {
    const tone = (status: Parameters<typeof orderStatusView>[0]["status"], s = 0) => orderStatusView({ status, updatedAt }, at(s)).tone;
    expect(tone("sent")).toBe("success");
    expect(tone("queued", 30)).toBe("info");
    expect(tone("unknown")).toBe("info");
    expect(tone("rejected")).toBe("danger");
    expect(tone("approval_rejected")).toBe("danger");
    expect(tone("queued", 150)).toBe("warning");
    expect(tone("awaiting_approval")).toBe("warning");
    expect(orderStatusLabels.sent.tone).not.toBe(orderStatusLabels.queued.tone);
  });
});
