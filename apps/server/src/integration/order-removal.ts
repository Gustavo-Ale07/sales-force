/**
 * RT-1 (owner ruling 2026-11-25): an order whose NUNOTA is no longer in Sankhya leaves the lists. Absence counts only when the
 * read SUCCEEDED and returned no row, in two consecutive readings, and never when most of a batch is absent at once (anti-mass-delete
 * guard, same spirit as MOB-GUARD). Pure: no I/O, so the rules are tested without a database.
 */

/** Consecutive confirmed-absent readings that mark an order as removed. */
export const REMOVAL_CONFIRMATIONS = 2;
/** The guard needs a batch of at least this many orders to judge "most of it is absent". */
export const MASS_ABSENCE_MIN_BATCH = 3;
/** Absent share (percent) of a batch at or above which the whole batch is suspect. */
export const MASS_ABSENCE_PERCENT = 90;

/** What one reading says about one order. `unknown` = no usable reading (failed, partial, billing/cancellation tables unreadable). */
export type OrderPresence = 'found' | 'absent' | 'unknown';

export interface RemovalInput {
  readonly presence: OrderPresence;
  readonly missingChecks: number;
  readonly removed: boolean;
}

export type RemovalDecision =
  | { readonly action: 'none' }
  | { readonly action: 'count'; readonly missingChecks: number }
  | { readonly action: 'remove'; readonly missingChecks: number }
  | { readonly action: 'reset' }
  | { readonly action: 'restore' };

/** True when the batch looks like a failed/partial read or a mass event rather than real deletions: nothing is counted. */
export function isSuspectBatch(presences: readonly OrderPresence[], expected: number): boolean {
  if (presences.length < expected) return true;
  const absent = presences.filter((p) => p === 'absent').length;
  return presences.length >= MASS_ABSENCE_MIN_BATCH && absent * 100 >= presences.length * MASS_ABSENCE_PERCENT;
}

/** Decision for one order. `suspect` freezes absence counting (state kept); a found reading is always honoured. */
export function decideRemoval(input: RemovalInput, suspect: boolean, countAbsence = true, confirmNow = false): RemovalDecision {
  if (input.presence === 'found') {
    if (input.removed) return { action: 'restore' };
    return input.missingChecks > 0 ? { action: 'reset' } : { action: 'none' };
  }
  if (input.presence === 'unknown' || suspect || !countAbsence || input.removed) return { action: 'none' };
  const next = input.missingChecks + 1;
  // `confirmNow` (owner's "Sincronizar agora"): ONE confirmed-absent reading made in that run is enough.
  return confirmNow || next >= REMOVAL_CONFIRMATIONS ? { action: 'remove', missingChecks: next } : { action: 'count', missingChecks: next };
}
