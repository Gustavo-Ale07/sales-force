/**
 * Release (liberação) state of an ERP order, from the facts of its release lines. Pure and deterministic:
 * it knows no Sankhya table or column. Owner rule (2026-11-10):
 *  - denied: some line is denied;
 *  - awaiting: some line has no release date and is not denied;
 *  - released: there are lines and every one has a release date;
 *  - no lines: no release state at all (`null`).
 * Denied wins over awaiting; a line the ERP both denied and dated is still denied.
 */
export type ErpReleaseState = 'awaiting' | 'released' | 'denied';

export const ERP_RELEASE_STATES: readonly ErpReleaseState[] = ['awaiting', 'released', 'denied'];

/** One release line. Who released it is deliberately not part of the facts. */
export interface ErpReleaseLine {
  readonly event: number;
  /** The line carries a release date. */
  readonly released: boolean;
  /** The line was denied. */
  readonly denied: boolean;
}

/** Raw facts of one release line, as read from the ERP. */
export interface ErpReleaseLineFacts {
  /** The line carries a release date (DHLIB filled). */
  readonly released: boolean;
  /** The ERP marked the line as reproved (REPROVADO = 'S'). */
  readonly reproved: boolean;
  /** Amount released (VLRLIBERADO); `null` when the ERP did not report one. */
  readonly releasedAmount: number | null;
}

/**
 * A line is denied when it is reproved, or when it carries a release date but a released amount of exactly zero. Same rule as
 * the Vidya production function (owner, 2026-11-10: 1 denied in 1,344 orders; normal releases have an amount above zero).
 * An unreported amount is not zero.
 */
export function isReleaseLineDenied(facts: ErpReleaseLineFacts): boolean {
  return facts.reproved || (facts.released && facts.releasedAmount === 0);
}

export function releaseStateOf(lines: readonly ErpReleaseLine[]): ErpReleaseState | null {
  if (lines.length === 0) return null;
  if (lines.some((line) => line.denied)) return 'denied';
  if (lines.some((line) => !line.released)) return 'awaiting';
  return 'released';
}

/** The state of one line, for display next to its event description. */
export function releaseLineState(line: ErpReleaseLine): ErpReleaseState {
  if (line.denied) return 'denied';
  return line.released ? 'released' : 'awaiting';
}
