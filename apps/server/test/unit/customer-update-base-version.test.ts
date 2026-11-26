import { describe, expect, it, vi } from 'vitest';
import { CustomerUpdateService } from '../../src/customers/customer-update.service.js';
import type { CurrentUser } from '../../src/iam/current-user.js';

const REQUEST_ID = '0b0f2c5e-0000-4000-8000-0000000000bb';

function build() {
  const requireVisible = vi.fn(async () => undefined);
  const service = new CustomerUpdateService(
    { customerScope: async () => ({ kind: 'all' }) } as never,
    { requireVisible } as never,
    { record: async () => undefined } as never,
    {} as never,
    () => new Date('2026-11-26T12:00:00Z'),
    true,
    { timeoutMs: 0, pollMs: 0, sleep: async () => undefined } as never,
  );
  (service as unknown as { findByOrigin: () => Promise<null> }).findByOrigin = async () => null;
  // Stops right after the version check: the transaction is the first database write.
  (service as unknown as { requireSameContactVersion: () => Promise<void> }).requireSameContactVersion = async () => {
    throw new Error('version-checked');
  };
  return service;
}

const userOn = (channel: 'web' | 'mobile') => ({ accountId: 'acc-1', role: 'seller', sellerCodes: [7], channel }) as unknown as CurrentUser;

describe('customer edit: baseContactVersion', () => {
  it('is mandatory from the app, so an offline conflict cannot be skipped', async () => {
    await expect(build().update(userOn('mobile'), 10, { clientRequestId: REQUEST_ID, phone: '11999990000' } as never)).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'base_contact_version_required' },
    });
  });

  it('is checked against the record when the app sends it', async () => {
    await expect(
      build().update(userOn('mobile'), 10, { clientRequestId: REQUEST_ID, phone: '11999990000', baseContactVersion: 'v1' } as never),
    ).rejects.toThrow('version-checked');
  });

  it('stays optional on the site', async () => {
    await expect(build().update(userOn('web'), 10, { clientRequestId: REQUEST_ID, phone: '11999990000' } as never)).rejects.not.toMatchObject({
      code: 'validation_failed',
    });
  });
});
