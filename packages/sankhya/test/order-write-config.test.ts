import { describe, expect, it } from 'vitest';
import { parseOrderWriteSettings } from '../src/write/order-write-config.js';

const LIVE = {
  SANKHYA_ORDER_WRITE_ENABLED: 'true',
  SANKHYA_ORDER_WRITE_MODE: 'live',
  SANKHYA_ORDER_WRITE_GATES_CLOSED: '1',
  SANKHYA_ORDER_ORIGIN_FIELD: 'AD_SFORIGEM',
  SANKHYA_MODE: 'live',
  SANKHYA_ENVIRONMENT: 'sandbox',
  SANKHYA_BASE_URL: 'https://api.sandbox.sankhya.com.br',
  NODE_ENV: 'development',
  SF_DEPLOY_ENVIRONMENT: 'staging',
};

describe('order write settings (SNK-7 S1, D-1)', () => {
  describe('request budget (M3)', () => {
    const live = {
      SANKHYA_ORDER_WRITE_ENABLED: 'true',
      SANKHYA_ORDER_WRITE_MODE: 'live',
      SANKHYA_MODE: 'live',
      SANKHYA_ENVIRONMENT: 'sandbox',
      SF_DEPLOY_ENVIRONMENT: 'staging',
      SANKHYA_ORDER_WRITE_GATES_CLOSED: '1',
      SANKHYA_ORDER_ORIGIN_FIELD: 'AD_SFORIGEM',
    };
    it('is null outside live mode and defaults to 40 in live mode', () => {
      expect(parseOrderWriteSettings({}).settings.requestBudget).toBeNull();
      expect(parseOrderWriteSettings({ SANKHYA_ORDER_WRITE_ENABLED: 'true' }).settings.requestBudget).toBeNull();
      expect(parseOrderWriteSettings(live).settings.requestBudget).toBe(40);
    });
    it('accepts an explicit integer and rejects garbage', () => {
      expect(parseOrderWriteSettings({ ...live, SANKHYA_ORDER_WRITE_REQUEST_BUDGET: '15' }).settings.requestBudget).toBe(15);
      const bad = parseOrderWriteSettings({ ...live, SANKHYA_ORDER_WRITE_REQUEST_BUDGET: '0' });
      expect(bad.problems.some((p) => p.includes('SANKHYA_ORDER_WRITE_REQUEST_BUDGET'))).toBe(true);
    });
  });

  it('is off by default and never needs anything', () => {
    expect(parseOrderWriteSettings({})).toEqual({ settings: { enabled: false, mode: 'off', originField: null, requestBudget: null }, problems: [] });
  });

  it('an explicit false stays off whatever the mode says', () => {
    const { settings, problems } = parseOrderWriteSettings({ SANKHYA_ORDER_WRITE_ENABLED: 'false', SANKHYA_ORDER_WRITE_MODE: 'live' });
    expect(settings.mode).toBe('off');
    expect(problems).toEqual([]);
  });

  it('rejects garbage values', () => {
    expect(parseOrderWriteSettings({ SANKHYA_ORDER_WRITE_ENABLED: 'yes' }).problems.join()).toContain('SANKHYA_ORDER_WRITE_ENABLED');
    expect(parseOrderWriteSettings({ SANKHYA_ORDER_WRITE_ENABLED: 'true', SANKHYA_ORDER_WRITE_MODE: 'go' }).problems.join()).toContain('SANKHYA_ORDER_WRITE_MODE');
    expect(parseOrderWriteSettings({ SANKHYA_ORDER_WRITE_GATES_CLOSED: 'yes' }).problems.join()).toContain('GATES_CLOSED');
  });

  it('enabled without a mode means dry_run, which needs none of the live prerequisites', () => {
    const { settings, problems } = parseOrderWriteSettings({ SANKHYA_ORDER_WRITE_ENABLED: 'true', SANKHYA_MODE: 'fake' });
    expect(settings).toEqual({ enabled: true, mode: 'dry_run', originField: null, requestBudget: null });
    expect(problems).toEqual([]);
  });

  it('accepts a complete live configuration against the Sandbox', () => {
    const { settings, problems } = parseOrderWriteSettings(LIVE);
    expect(problems).toEqual([]);
    expect(settings).toEqual({ enabled: true, mode: 'live', originField: 'AD_SFORIGEM', requestBudget: 40 });
  });

  describe('gate by deployment environment (I1)', () => {
    const STAGING = { NODE_ENV: 'production', SF_DEPLOY_ENVIRONMENT: 'staging' };

    it('staging runs with NODE_ENV=production: dry_run and live are accepted there', () => {
      expect(parseOrderWriteSettings({ ...STAGING, SANKHYA_ORDER_WRITE_ENABLED: 'true', SANKHYA_ORDER_WRITE_MODE: 'dry_run' }).problems).toEqual([]);
      expect(parseOrderWriteSettings({ ...LIVE, ...STAGING }).problems).toEqual([]);
    });

    it.each([
      ['production', { NODE_ENV: 'production', SF_DEPLOY_ENVIRONMENT: 'production' }],
      ['empty under NODE_ENV=production', { NODE_ENV: 'production', SF_DEPLOY_ENVIRONMENT: '' }],
      ['unknown value', { NODE_ENV: 'production', SF_DEPLOY_ENVIRONMENT: 'prod-eu' }],
      ['unknown value in development', { NODE_ENV: 'development', SF_DEPLOY_ENVIRONMENT: 'prod-eu' }],
    ])('enabling the write is refused: %s', (_name, patch) => {
      const { problems } = parseOrderWriteSettings({ SANKHYA_ORDER_WRITE_ENABLED: 'true', SANKHYA_ORDER_WRITE_MODE: 'dry_run', ...patch });
      expect(problems.join('\n')).toContain('SF_DEPLOY_ENVIRONMENT');
    });

    it('an explicit production deployment refuses the write even outside NODE_ENV=production', () => {
      const { problems } = parseOrderWriteSettings({ SANKHYA_ORDER_WRITE_ENABLED: 'true', NODE_ENV: 'development', SF_DEPLOY_ENVIRONMENT: 'production' });
      expect(problems.join('\n')).toContain('only accepted when SF_DEPLOY_ENVIRONMENT=staging');
    });

    it('does not loosen the other live gates: staging with a wrong host, environment or no marker still refuses live', () => {
      expect(parseOrderWriteSettings({ ...LIVE, ...STAGING, SANKHYA_BASE_URL: 'https://erp.example.test' }).problems.join()).toContain('Sandbox write hosts');
      expect(parseOrderWriteSettings({ ...LIVE, ...STAGING, SANKHYA_ENVIRONMENT: 'production' }).problems.join()).toContain('SANKHYA_ENVIRONMENT=sandbox');
      expect(parseOrderWriteSettings({ ...LIVE, ...STAGING, SANKHYA_ORDER_WRITE_GATES_CLOSED: undefined }).problems.join()).toContain('GATES_CLOSED=1');
    });

    it('write off needs nothing but the variable is still validated under NODE_ENV=production', () => {
      expect(parseOrderWriteSettings({ NODE_ENV: 'production' }).problems.join()).toContain('SF_DEPLOY_ENVIRONMENT');
      expect(parseOrderWriteSettings({ NODE_ENV: 'production', SF_DEPLOY_ENVIRONMENT: 'production' }).problems).toEqual([]);
    });
  });

  it.each([
    ['gates marker', { SANKHYA_ORDER_WRITE_GATES_CLOSED: undefined }, 'GATES_CLOSED=1'],
    ['gates marker 0', { SANKHYA_ORDER_WRITE_GATES_CLOSED: '0' }, 'GATES_CLOSED=1'],
    ['origin field', { SANKHYA_ORDER_ORIGIN_FIELD: undefined }, 'SANKHYA_ORDER_ORIGIN_FIELD'],
    ['sandbox environment', { SANKHYA_ENVIRONMENT: 'homologation' }, 'SANKHYA_ENVIRONMENT=sandbox'],
    ['production environment', { SANKHYA_ENVIRONMENT: 'production' }, 'SANKHYA_ENVIRONMENT=sandbox'],
    ['real adapter', { SANKHYA_MODE: 'fake' }, 'SANKHYA_MODE=live'],
    ['deploy environment production', { NODE_ENV: 'production', SF_DEPLOY_ENVIRONMENT: 'production' }, 'SF_DEPLOY_ENVIRONMENT=staging'],
    ['explicit staging deploy environment (unset in development)', { SF_DEPLOY_ENVIRONMENT: undefined }, 'explicit SF_DEPLOY_ENVIRONMENT=staging'],
    ['deploy environment (unset under NODE_ENV=production)', { NODE_ENV: 'production', SF_DEPLOY_ENVIRONMENT: undefined }, 'SF_DEPLOY_ENVIRONMENT'],
    ['host outside the allow-list', { SANKHYA_BASE_URL: 'https://erp.example.test' }, 'Sandbox write hosts'],
    ['host lookalike', { SANKHYA_BASE_URL: 'https://api.sandbox.sankhya.com.br.evil.test' }, 'Sandbox write hosts'],
  ])('live is refused without the %s', (_name, patch, expected) => {
    const { problems } = parseOrderWriteSettings({ ...LIVE, ...patch });
    expect(problems.join('\n')).toContain(expected);
  });

  it('refuses the Vidya origin fields and malformed names (the name goes into a SELECT)', () => {
    for (const name of ['AD_VDYORIG', 'ad_nuvidya', 'NUNOTA', 'AD_X; DROP', 'AD_', "AD_A'B", 'AD_' + 'X'.repeat(28)]) {
      const { problems } = parseOrderWriteSettings({ ...LIVE, SANKHYA_ORDER_ORIGIN_FIELD: name });
      expect(problems.join(), name).toContain('SANKHYA_ORDER_ORIGIN_FIELD');
    }
  });

  it('never echoes values in problems', () => {
    const { problems } = parseOrderWriteSettings({ ...LIVE, SANKHYA_BASE_URL: 'https://secret-host.example.test', SANKHYA_ORDER_ORIGIN_FIELD: 'bad value' });
    expect(problems.join()).not.toContain('secret-host');
    expect(problems.join()).not.toContain('bad value');
  });
});
