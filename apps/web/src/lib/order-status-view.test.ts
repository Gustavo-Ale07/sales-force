import { describe, expect, it } from "vitest";
import { orderStatusView } from "./labels";

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
});
