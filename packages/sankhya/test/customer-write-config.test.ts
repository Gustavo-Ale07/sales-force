import { describe, expect, it } from 'vitest';
import { describeCustomerWrite, parseCustomerWriteSettings } from '../src/write/customer-write-config.js';

const ON = {
  SANKHYA_CUSTOMER_WRITE_ENABLED: 'true',
  SANKHYA_MODE: 'live',
  SANKHYA_ENVIRONMENT: 'sandbox',
  SANKHYA_BASE_URL: 'https://api.sandbox.sankhya.com.br',
  NODE_ENV: 'production',
  SF_DEPLOY_ENVIRONMENT: 'staging',
};

describe('customer write settings (D-AR, flag closed by default)', () => {
  it('is closed by default and needs nothing', () => {
    expect(parseCustomerWriteSettings({})).toEqual({ settings: { enabled: false }, problems: [] });
    expect(parseCustomerWriteSettings({ SANKHYA_CUSTOMER_WRITE_ENABLED: 'false' }).settings.enabled).toBe(false);
  });

  it('opens only on staging, against the Sandbox allowlist, with the explicit sandbox mode', () => {
    expect(parseCustomerWriteSettings(ON)).toEqual({ settings: { enabled: true }, problems: [] });
  });

  it('rejects garbage values', () => {
    const r = parseCustomerWriteSettings({ SANKHYA_CUSTOMER_WRITE_ENABLED: 'yes' });
    expect(r.settings.enabled).toBe(false);
    expect(r.problems.some((p) => p.includes('SANKHYA_CUSTOMER_WRITE_ENABLED'))).toBe(true);
  });

  it.each([
    ['production', { SF_DEPLOY_ENVIRONMENT: 'production' }],
    ['unset deploy environment', { SF_DEPLOY_ENVIRONMENT: undefined }],
    ['mock gateway', { SANKHYA_MODE: 'mock' }],
    ['environment not explicit', { SANKHYA_ENVIRONMENT: undefined }],
    ['environment production', { SANKHYA_ENVIRONMENT: 'production' }],
    ['host off the allowlist', { SANKHYA_BASE_URL: 'https://api.sankhya.com.br' }],
    ['no base url', { SANKHYA_BASE_URL: undefined }],
  ])('refuses at boot: %s', (_name, override) => {
    const r = parseCustomerWriteSettings({ ...ON, ...override });
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.problems.every((p) => p.includes('SANKHYA_CUSTOMER_WRITE_ENABLED') || p.includes('SF_DEPLOY_ENVIRONMENT'))).toBe(true);
  });

  it('does not complain about other variables while closed', () => {
    expect(parseCustomerWriteSettings({ SF_DEPLOY_ENVIRONMENT: 'production', SANKHYA_MODE: 'live' }).problems).toEqual([]);
  });

  it('describes itself for the health page without secrets', () => {
    expect(describeCustomerWrite({ enabled: false })).toBe('escrita de cliente: desligada');
    expect(describeCustomerWrite({ enabled: true })).toBe('escrita de cliente: ligada (Sandbox)');
  });
});
