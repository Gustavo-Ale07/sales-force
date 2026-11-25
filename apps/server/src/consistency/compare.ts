import type { Differences } from './types.js';

export interface MirrorRowState {
  readonly hash: string;
  readonly deleted: boolean;
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Compares what Sankhya returns now (key -> content hash of the SAME mapped row the mirror writes) with the mirror's rows.
 * - missing: the source has it and the Force has no live row (absent, or soft-deleted and not reactivated);
 * - extra: the Force row is live and the source no longer returns it;
 * - divergent: both live, different content hash.
 * Pure; callers must only call it with a COMPLETE source read (a partial read would turn into false extras).
 */
export function diffKeyed(source: ReadonlyMap<string, string>, mirror: ReadonlyMap<string, MirrorRowState>): Differences {
  const missing: string[] = [];
  const divergent: string[] = [];
  const extra: string[] = [];
  for (const [key, hash] of source) {
    const row = mirror.get(key);
    if (row === undefined || row.deleted) missing.push(key);
    else if (row.hash !== hash) divergent.push(key);
  }
  for (const [key, row] of mirror) {
    if (!row.deleted && !source.has(key)) extra.push(key);
  }
  return { missing: missing.sort(byKey), extra: extra.sort(byKey), divergent: divergent.sort(byKey) };
}

export function liveCount(mirror: ReadonlyMap<string, MirrorRowState>): number {
  let n = 0;
  for (const row of mirror.values()) if (!row.deleted) n += 1;
  return n;
}
