/**
 * Mobile device lifecycle rules (AUTH-2, RF-IAM-7, RF-IAM-8; security-model 4.1). Pure: no I/O, no clock of its own.
 * The site and the app read the same rules, so the server decision and the on-device lock never disagree.
 */

export const DEVICE_STATUSES = ['pending', 'approved', 'revoked'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** Offline lock (RF-IAM-8): default days without a synchronization, and the bounds the installation setting may take. */
export const DEFAULT_OFFLINE_MAX_DAYS = 7;
export const MIN_OFFLINE_MAX_DAYS = 1;
export const MAX_OFFLINE_MAX_DAYS = 60;
/** AUTH-2: at most this many approved devices per account unless the installation setting says otherwise. */
export const DEFAULT_MAX_ACTIVE_DEVICES = 1;
export const MIN_MAX_ACTIVE_DEVICES = 1;
export const MAX_MAX_ACTIVE_DEVICES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Status a new device starts in. An administrator's own device is approved on registration (nobody else could approve it
 * and the admin can approve it anyway); every other mobile profile waits for an approval before any business data is sent.
 * Fail closed: an unknown role starts pending.
 */
export function initialDeviceStatus(role: string): DeviceStatus {
  return role === 'admin' ? 'approved' : 'pending';
}

/**
 * Who may approve or revoke the device of an account (never one's own). The administrator: any device. A manager: only
 * the devices of accounts `inTeam` says are in the manager's team (the caller decides membership; no team entity exists
 * yet, see `DeviceTeamPort` on the server). Everyone else: nobody.
 */
export function mayManageDevice(input: {
  readonly actorRole: string;
  readonly actorAccountId: string;
  readonly ownerAccountId: string;
  readonly ownerInActorTeam: boolean;
}): boolean {
  if (input.actorAccountId === input.ownerAccountId && input.actorRole !== 'admin') return false;
  if (input.actorRole === 'admin') return true;
  if (input.actorRole === 'manager') return input.ownerInActorTeam;
  return false;
}

/** Legal status moves: pending -> approved | revoked, approved -> revoked. A revoked device never comes back (a new install registers anew). */
export function canTransitionDevice(from: DeviceStatus, to: DeviceStatus): boolean {
  if (from === 'pending') return to === 'approved' || to === 'revoked';
  if (from === 'approved') return to === 'revoked';
  return false;
}

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
