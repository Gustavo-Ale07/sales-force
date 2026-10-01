import { isOperationalEligibility, type DraftRecord, type DraftStatus } from "@salesforce/mobile-db";
import { saleActions } from "./sales-status";

/** Lower rank = more relevant to resume: something the seller must act on, then unsent work. Orders already synced are never offered (they have no Continuar in the Central). */
const RESUME_RANK: Record<DraftStatus, number> = {
  conflict: 0,
  needs_review: 0,
  sync_error: 0,
  local_only: 1,
  pending_sync: 1,
  syncing: 1,
  synced: 2,
};

/** The draft "Retomar pedido" opens: by relevance first, then the most recently edited. `null` when there is none. */
export function pickResumableDraft(drafts: readonly DraftRecord[]): DraftRecord | null {
  let best: DraftRecord | null = null;
  for (const draft of drafts) {
    if (!saleActions(draft).continue) continue;
    // Work of another dataset / legacy work is never offered as a normal order to resume.
    if (!isOperationalEligibility(draft.eligibility)) continue;
    if (best === null) {
      best = draft;
      continue;
    }
    const rank = RESUME_RANK[draft.status] - RESUME_RANK[best.status];
    if (rank < 0 || (rank === 0 && draft.updatedAt > best.updatedAt)) best = draft;
  }
  return best;
}
