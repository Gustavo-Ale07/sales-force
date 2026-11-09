import { describe, expect, it } from "vitest";
import { erpNoteDiverged, erpNoteDivergedText } from "./labels";

describe("erpNoteDiverged (D-AK)", () => {
  it("is true only when the ERP note exists and the last failure is a reread divergence", () => {
    expect(erpNoteDiverged({ erpNumber: 2499, erpDelivery: { errorCode: "discount_divergence" } })).toBe(true);
    expect(erpNoteDiverged({ erpNumber: 2499, erpDelivery: { errorCode: "total_divergence" } })).toBe(true);
    expect(erpNoteDiverged({ erpNumber: null, erpDelivery: { errorCode: "discount_divergence" } })).toBe(false);
    expect(erpNoteDiverged({ erpNumber: 2499, erpDelivery: { errorCode: "include_timeout_unconfirmed" } })).toBe(false);
    expect(erpNoteDiverged(null)).toBe(false);
  });

  it("tells the seller to ask IT", () => {
    expect(erpNoteDivergedText(2499)).toBe("A nota nº 2499 já existe no Sankhya com valores diferentes do pedido. Peça à TI para conferir; o Force não reenvia.");
  });
});
