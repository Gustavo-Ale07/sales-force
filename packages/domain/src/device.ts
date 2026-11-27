/**
 * Offline lock rules (RF-IAM-8). Device approval was removed (owner ruling 2026-11-27, server code instead). Pure: no I/O, no clock of its own.
 * The site and the app read the same rules, so the server decision and the on-device lock never disagree.
 */

/** Offline lock (RF-IAM-8): default days without a synchronization, and the bounds the installation setting may take. */
export const DEFAULT_OFFLINE_MAX_DAYS = 7;
export const MIN_OFFLINE_MAX_DAYS = 1;
export const MAX_OFFLINE_MAX_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export function clampOfflineMaxDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OFFLINE_MAX_DAYS;
  return Math.min(MAX_OFFLINE_MAX_DAYS, Math.max(MIN_OFFLINE_MAX_DAYS, Math.trunc(value)));
}

export type OfflineLock =
  | { readonly locked: false }
  | { readonly locked: true; readonly reason: 'never_synced' | 'limit_reached' };

/**
 * RF-IAM-8: the app is blocked when the last successful synchronization is older than `maxDays` (whole days). Never
 * synchronized = blocked. A last sync in the future (clock moved back) is NOT trusted as fresh: it counts as the limit
 * reached, since the elapsed time cannot be proven (R16 is UNDECIDED; this is the lowest-risk reading).
 */
export function evaluateOfflineLock(lastSyncAt: Date | null, now: Date, maxDays: number): OfflineLock {
  if (lastSyncAt === null || Number.isNaN(lastSyncAt.getTime())) return { locked: true, reason: 'never_synced' };
  const elapsed = now.getTime() - lastSyncAt.getTime();
  if (elapsed < 0) return { locked: true, reason: 'limit_reached' };
  return elapsed > clampOfflineMaxDays(maxDays) * DAY_MS ? { locked: true, reason: 'limit_reached' } : { locked: false };
}
