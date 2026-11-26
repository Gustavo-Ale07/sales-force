import { describe, expect, it } from 'vitest';
import { MIRROR_SPECS } from '../../src/sync/mirror-entities.js';
import { isEmptySnapshotBlocked } from '../../src/sync/mirror-writer.js';

describe('empty_snapshot guard decision', () => {
  const protectedEntities = ['customers', 'products', 'productGroups', 'priceTables', 'priceTableVersions', 'listPrices', 'sellers', 'directoryUsers', 'cities', 'neighborhoods', 'streets', 'postalCodes'];

  it('keeps the guard for protected entities: empty read against live rows is blocked', () => {
    const names = new Set(Object.keys(MIRROR_SPECS));
    for (const entity of protectedEntities) {
      if (names.has(entity)) expect(isEmptySnapshotBlocked(entity, 0, 5)).toBe(true);
    }
    expect(isEmptySnapshotBlocked('customers', 0, 1)).toBe(true);
  });

  it('lets the Force configuration tables go empty: the manager may remove every row in the ERP', () => {
    expect(isEmptySnapshotBlocked('forceConfig', 0, 1)).toBe(false);
    expect(isEmptySnapshotBlocked('forceDiscountLimits', 0, 40)).toBe(false);
  });

  it('lets openTitles deactivate the last live row on an empty healthy snapshot', () => {
    expect(isEmptySnapshotBlocked('openTitles', 0, 1)).toBe(false);
    expect(isEmptySnapshotBlocked('openTitles', 0, 40)).toBe(false);
  });

  it('never blocks a non-empty read or an empty mirror', () => {
    expect(isEmptySnapshotBlocked('customers', 3, 5)).toBe(false);
    expect(isEmptySnapshotBlocked('customers', 0, 0)).toBe(false);
  });
});
