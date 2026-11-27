import { describe, expect, it } from 'vitest';
import { clampOfflineMaxDays, evaluateOfflineLock } from '../src/device.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 86_400_000 - extraMs);

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
