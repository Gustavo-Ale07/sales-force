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
};

describe('order write settings (SNK-7 S1, D-1)', () => {
  it('is off by default and never needs anything', () => {
    expect(parseOrderWriteSettings({})).toEqual({ settings: { enabled: false, mode: 'off', originField: null }, problems: [] });
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
    expect(settings).toEqual({ enabled: true, mode: 'dry_run', originField: null });
    expect(problems).toEqual([]);
  });

  it('accepts a complete live configuration against the Sandbox', () => {
    const { settings, problems } = parseOrderWriteSettings(LIVE);
    expect(problems).toEqual([]);
    expect(settings).toEqual({ enabled: true, mode: 'live', originField: 'AD_SFORIGEM' });
  });

  it.each([
    ['gates marker', { SANKHYA_ORDER_WRITE_GATES_CLOSED: undefined }, 'GATES_CLOSED=1'],
    ['gates marker 0', { SANKHYA_ORDER_WRITE_GATES_CLOSED: '0' }, 'GATES_CLOSED=1'],
    ['origin field', { SANKHYA_ORDER_ORIGIN_FIELD: undefined }, 'SANKHYA_ORDER_ORIGIN_FIELD'],
    ['sandbox environment', { SANKHYA_ENVIRONMENT: 'homologation' }, 'SANKHYA_ENVIRONMENT=sandbox'],
    ['production environment', { SANKHYA_ENVIRONMENT: 'production' }, 'SANKHYA_ENVIRONMENT=sandbox'],
    ['real adapter', { SANKHYA_MODE: 'fake' }, 'SANKHYA_MODE=live'],
    ['NODE_ENV production (staging included)', { NODE_ENV: 'production' }, 'NODE_ENV=production'],
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
