import { DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import { PolicyService } from '../../src/iam/policy.service.js';

/** LOW-3: a failing audit write must not turn a scope denial into anything but the 403 (fail closed). */

const user: CurrentUser = {
  accountId: '0190e1a0-0000-7000-8000-000000000001',
  email: 'x@example.test',
  displayName: 'X',
  role: 'seller',
  sellerCodes: [],
  sessionId: 's',
  sessionExpiresAt: new Date('2030-01-01T00:00:00Z'),
  channel: 'web',
};

describe('PolicyService scope denial with a failing audit', () => {
  it('still answers 403 no_seller_scope and logs a warning', async () => {
    const warnings: unknown[] = [];
    const policy = new PolicyService(
      { current: async () => ({ configuration: DEMO_CONFIGURATION }) } as never,
      {} as never,
      { record: async () => { throw new Error('audit down'); } } as never,
      () => new Date('2030-01-01T00:00:00Z'),
      { warn: (...args: unknown[]) => warnings.push(args) } as never,
    );
    const error = await policy.customerScope(user).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('no_seller_scope');
    expect((error as AppError).status).toBe(403);
    expect(warnings).toHaveLength(1);
  });
});
