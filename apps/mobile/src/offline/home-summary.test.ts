import type { DraftRecord, DraftStatus } from "@salesforce/mobile-db";
import { pickResumableDraft } from "./home-summary";

function draft(localId: string, status: DraftStatus, updatedAt: string): DraftRecord {
  return {
    localId,
    ownerAccountId: "a",
    clientRequestId: `r-${localId}`,
    customerCode: 1,
    customerName: "Cliente",
    negotiationTypeCode: null,
    notes: null,
    status,
    remoteId: null,
    remoteVersion: null,
    remoteDraftNumber: null,
    estimatedTotal: null,
    lastError: null,
    priceReview: null,
    serverSnapshot: null,
    createdAt: updatedAt,
    updatedAt,
    itemCount: 1,
  };
}

describe("pickResumableDraft", () => {
  it("returns null when there is no draft", () => {
    expect(pickResumableDraft([])).toBeNull();
  });

  it("prefers a draft that needs the seller's attention over a newer unsent one", () => {
    const picked = pickResumableDraft([
      draft("new", "local_only", "2026-09-30T12:00:00Z"),
      draft("review", "needs_review", "2026-09-29T12:00:00Z"),
    ]);
    expect(picked?.localId).toBe("review");
  });

  it("prefers unsent work over an already delivered draft", () => {
    const picked = pickResumableDraft([
      draft("sent", "synced", "2026-09-30T12:00:00Z"),
      draft("wait", "pending_sync", "2026-09-28T12:00:00Z"),
    ]);
    expect(picked?.localId).toBe("wait");
  });

  it("takes the most recently edited among equals, and still offers a delivered draft when it is all there is", () => {
    expect(
      pickResumableDraft([draft("old", "local_only", "2026-09-28T12:00:00Z"), draft("recent", "local_only", "2026-09-30T12:00:00Z")])?.localId,
    ).toBe("recent");
    expect(pickResumableDraft([draft("only", "synced", "2026-09-30T12:00:00Z")])?.localId).toBe("only");
  });
});
