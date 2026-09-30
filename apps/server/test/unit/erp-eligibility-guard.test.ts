import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { assertEligibleForErpSubmission } from '../../src/orders/erp-eligibility.guard.js';

const target = { environment: 'sandbox' };

describe('assertEligibleForErpSubmission', () => {
  it('accepts a Sankhya order bound to the target environment', () => {
    expect(() => assertEligibleForErpSubmission({ datasetOrigin: 'sankhya', erpEnvironment: 'sandbox' }, target)).not.toThrow();
  });

  it.each([
    [{ datasetOrigin: 'legacy_dev', erpEnvironment: null }, 'dataset_not_erp'],
    [{ datasetOrigin: 'fake', erpEnvironment: null }, 'dataset_not_erp'],
    [{ datasetOrigin: 'sankhya', erpEnvironment: null }, 'environment_unbound'],
    [{ datasetOrigin: 'sankhya', erpEnvironment: 'dev' }, 'environment_mismatch'],
    [{ datasetOrigin: 'sankhya', erpEnvironment: 'production' }, 'environment_mismatch'],
  ])('refuses %j with %s', (binding, reason) => {
    try {
      assertEligibleForErpSubmission(binding, target);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('conflict');
      expect((error as AppError).details).toEqual({ reason });
    }
  });
});
