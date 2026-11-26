import { describe, expect, it } from 'vitest';
import { canTransitionDevice, clampOfflineMaxDays, evaluateOfflineLock, initialDeviceStatus, mayManageDevice } from '../src/device.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 86_400_000 - extraMs);

describe('initialDeviceStatus', () => {
  it('approves an admin device and holds every other profile', () => {
    expect(initialDeviceStatus('admin')).toBe('approved');
    for (const role of ['manager', 'seller', 'technical', 'operations', 'unknown']) expect(initialDeviceStatus(role)).toBe('pending');
  });
});

describe('mayManageDevice', () => {
  const base = { actorAccountId: 'a', ownerAccountId: 'b', ownerInActorTeam: false };
  it('admin manages any device', () => expect(mayManageDevice({ ...base, actorRole: 'admin' })).toBe(true));
  it('manager only inside the team', () => {
    expect(mayManageDevice({ ...base, actorRole: 'manager', ownerInActorTeam: true })).toBe(true);
    expect(mayManageDevice({ ...base, actorRole: 'manager', ownerInActorTeam: false })).toBe(false);
  });
  it('a manager never manages their own device', () => {
    expect(mayManageDevice({ ...base, actorRole: 'manager', ownerAccountId: 'a', ownerInActorTeam: true })).toBe(false);
  });
  it('seller, technical, operations and unknown never', () => {
    for (const actorRole of ['seller', 'technical', 'operations', 'x']) expect(mayManageDevice({ ...base, actorRole, ownerInActorTeam: true })).toBe(false);
  });
});

describe('canTransitionDevice', () => {
  it('moves forward only', () => {
    expect(canTransitionDevice('pending', 'approved')).toBe(true);
    expect(canTransitionDevice('pending', 'revoked')).toBe(true);
    expect(canTransitionDevice('approved', 'revoked')).toBe(true);
    expect(canTransitionDevice('approved', 'approved')).toBe(false);
    expect(canTransitionDevice('revoked', 'approved')).toBe(false);
    expect(canTransitionDevice('approved', 'pending')).toBe(false);
  });
});

describe('evaluateOfflineLock', () => {
  it('is not locked inside the limit and at exactly the limit', () => {
    expect(evaluateOfflineLock(daysAgo(6), NOW, 7)).toEqual({ locked: false });
    expect(evaluateOfflineLock(daysAgo(7), NOW, 7)).toEqual({ locked: false });
  });
  it('locks past the limit', () => {
    expect(evaluateOfflineLock(daysAgo(7, 1), NOW, 7)).toEqual({ locked: true, reason: 'limit_reached' });
  });
  it('follows the configured days', () => {
    expect(evaluateOfflineLock(daysAgo(3), NOW, 2)).toEqual({ locked: true, reason: 'limit_reached' });
    expect(evaluateOfflineLock(daysAgo(10), NOW, 14)).toEqual({ locked: false });
  });
  it('locks a device that never synchronized and a last sync in the future', () => {
    expect(evaluateOfflineLock(null, NOW, 7)).toEqual({ locked: true, reason: 'never_synced' });
    expect(evaluateOfflineLock(new Date(NOW.getTime() + 1000), NOW, 7)).toEqual({ locked: true, reason: 'limit_reached' });
  });
  it('clamps absurd settings', () => {
    expect(clampOfflineMaxDays(0)).toBe(1);
    expect(clampOfflineMaxDays(999)).toBe(60);
    expect(clampOfflineMaxDays(Number.NaN)).toBe(7);
  });
});
