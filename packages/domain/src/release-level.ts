/**
 * Release level awaited by an order (owner decision 2026-11-25, informed by the owner from a production read, not a validation of
 * ours: docs/sankhya-spike.md 9.63). The level is `TSILIB.SEQCASCATA` of the release lines of event 44; the order waits for the
 * LOWEST level whose line is still pending (DHLIB null). It is never taken from TSILIM nor from configured sector users. An order
 * with no TSILIB line at all is "not confirmed in Sankhya yet", which is a normal state, not an error. The Force releases nothing.
 * Pure: the site and the app show the same text (`releaseLevelText`).
 */

/** Release event whose cascade level is the awaited level (owner 2026-11-25; it holds for any TOP). */
export const RELEASE_LEVEL_EVENT = 44;

/** One TSILIB line of the order (TABELA = 'TGFCAB'). `released` = DHLIB filled; `reproved` = REPROVADO = 'S'. */
export interface ReleaseLine {
  readonly event: number;
  readonly cascadeSequence: number | null;
  readonly released: boolean;
  readonly reproved: boolean;
}

export type ReleaseLevelState =
  /** The ERP has no release line for the order yet. */
  | { readonly state: 'not_confirmed'; readonly level: null }
  /** An event 44 line is pending: `level` = its SEQCASCATA (the lowest pending one). */
  | { readonly state: 'awaiting'; readonly level: number }
  /** There are lines but no pending event 44 line with a level (all released, or only other events). */
  | { readonly state: 'none'; readonly level: null };

export function awaitedReleaseLevel(lines: readonly ReleaseLine[]): ReleaseLevelState {
  if (lines.length === 0) return { state: 'not_confirmed', level: null };
  let lowest: number | null = null;
  for (const line of lines) {
    if (line.event !== RELEASE_LEVEL_EVENT || line.released || line.cascadeSequence === null) continue;
    if (lowest === null || line.cascadeSequence < lowest) lowest = line.cascadeSequence;
  }
  return lowest === null ? { state: 'none', level: null } : { state: 'awaiting', level: lowest };
}

export const RELEASE_NOT_CONFIRMED_LABEL = 'Ainda não confirmado no Sankhya';

export function releaseLevelLabel(level: number): string {
  return `Nível ${level}`;
}

/** The text both clients show; `null` = nothing to show for this state. */
export function releaseLevelText(state: ReleaseLevelState): string | null {
  if (state.state === 'awaiting') return releaseLevelLabel(state.level);
  if (state.state === 'not_confirmed') return RELEASE_NOT_CONFIRMED_LABEL;
  return null;
}
