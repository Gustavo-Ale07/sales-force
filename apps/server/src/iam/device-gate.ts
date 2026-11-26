import { AppError } from '../http/app-error.js';
import type { CurrentUser } from './current-user.js';

/** Routes a revoked or pending device may still call: end the session, and read its own status. */
const ALWAYS_ALLOWED = new Set(['logout']);
const PENDING_ALLOWED = new Set(['logout', 'getMyDevice']);

/**
 * AUTH-1/AUTH-2 per-request device gate. A session without a device (the site, legacy app sessions) is not gated. A revoked device
 * gets 401 `device_revoked` (the app wipes its local database); a pending one gets 403 `device_pending` for everything except
 * reading its own status and logging out, so no business data reaches an unapproved installation.
 */
export function assertDeviceMayCall(user: Pick<CurrentUser, 'deviceId' | 'deviceStatus'>, operationId: string): void {
  const status = user.deviceId === undefined || user.deviceId === null ? null : (user.deviceStatus ?? null);
  if (status === 'revoked' && !ALWAYS_ALLOWED.has(operationId)) throw new AppError('device_revoked');
  if (status === 'pending' && !PENDING_ALLOWED.has(operationId)) throw new AppError('device_pending');
}
