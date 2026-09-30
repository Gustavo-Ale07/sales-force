import { describe, expect, it } from 'vitest';
import {
  canQueueOrder,
  datasetOriginForConfigurationSource,
  erpSubmissionBlock,
  isEligibleForErpSubmission,
  type ErpBinding,
} from '../src/index.js';

const bound = (over: Partial<ErpBinding> = {}): ErpBinding => ({
  datasetOrigin: 'sankhya',
  erpEnvironment: 'sandbox',
  ...over,
});

describe('isEligibleForErpSubmission', () => {
  it('accepts an order bound to the very environment being targeted', () => {
    expect(isEligibleForErpSubmission(bound(), { environment: 'sandbox' })).toBe(true);
    expect(erpSubmissionBlock(bound(), { environment: 'sandbox' })).toBeNull();
  });

  it('rejects legacy, fake and demo datasets whatever the environment', () => {
    for (const origin of ['legacy_dev', 'fake', 'demo'] as const) {
      const order = bound({ datasetOrigin: origin });
      expect(isEligibleForErpSubmission(order, { environment: 'sandbox' }), origin).toBe(false);
      expect(isEligibleForErpSubmission(order, { environment: 'homologation' }), origin).toBe(false);
    }
    expect(erpSubmissionBlock(bound({ datasetOrigin: 'legacy_dev' }), { environment: 'sandbox' })).toBe('dataset_not_erp');
  });

  it('rejects an order bound to dev for a sandbox or homologation target', () => {
    const order = bound({ erpEnvironment: 'dev' });
    expect(isEligibleForErpSubmission(order, { environment: 'sandbox' })).toBe(false);
    expect(isEligibleForErpSubmission(order, { environment: 'homologation' })).toBe(false);
    expect(erpSubmissionBlock(order, { environment: 'sandbox' })).toBe('environment_mismatch');
  });

  it('rejects an order with no environment binding (fail closed)', () => {
    expect(isEligibleForErpSubmission(bound({ erpEnvironment: null }), { environment: 'sandbox' })).toBe(false);
    expect(erpSubmissionBlock(bound({ erpEnvironment: null }), { environment: 'sandbox' })).toBe('environment_unbound');
  });

  it('rejects unknown values instead of trusting them', () => {
    expect(isEligibleForErpSubmission({ datasetOrigin: 'x', erpEnvironment: 'sandbox' }, { environment: 'sandbox' })).toBe(false);
    expect(isEligibleForErpSubmission(bound(), { environment: '' })).toBe(false);
  });
});

describe('canQueueOrder', () => {
  it('a legacy order can never be queued', () => {
    expect(canQueueOrder({ status: 'draft', ...bound({ datasetOrigin: 'legacy_dev' }) }, { environment: 'sandbox' })).toBe(false);
  });

  it('stays false for every order today: draft -> queued is not reachable (SNK-6)', () => {
    expect(canQueueOrder({ status: 'draft', ...bound() }, { environment: 'sandbox' })).toBe(false);
  });
});

describe('datasetOriginForConfigurationSource', () => {
  it('maps the configuration source kind, failing closed on anything unknown', () => {
    expect(datasetOriginForConfigurationSource('sankhya')).toBe('sankhya');
    expect(datasetOriginForConfigurationSource('demo')).toBe('fake');
    expect(datasetOriginForConfigurationSource('bootstrap-file')).toBe('fake');
    expect(datasetOriginForConfigurationSource('whatever')).toBe('fake');
  });
});
