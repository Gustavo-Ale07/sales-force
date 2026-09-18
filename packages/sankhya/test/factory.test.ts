import { describe, expect, it } from 'vitest';
import { FakeGateway, GatewayConfigError, RealSankhyaGateway, createGateway, type GatewayEnvironment } from '../src/index.js';
import { MockSankhya, TEST_CREDENTIALS, TEST_HOST, erpTablesFromDataset } from './support/mock-sankhya.js';
import { getDemoDataset } from '../src/index.js';

const LIVE_ENV: GatewayEnvironment = {
  SANKHYA_MODE: 'live',
  SANKHYA_BASE_URL: `https://${TEST_HOST}`,
  SANKHYA_ALLOWED_HOSTS: TEST_HOST,
  SANKHYA_ENVIRONMENT: 'sandbox',
  SANKHYA_CLIENT_ID: TEST_CREDENTIALS.clientId,
  SANKHYA_CLIENT_SECRET: TEST_CREDENTIALS.clientSecret,
  SANKHYA_X_TOKEN: TEST_CREDENTIALS.xToken,
};

function problemsOf(env: GatewayEnvironment): readonly string[] {
  try {
    createGateway(env, { transport: () => Promise.reject(new Error('never called')) });
  } catch (error) {
    if (error instanceof GatewayConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('createGateway', () => {
  it('defaults to the fake gateway', () => {
    expect(createGateway({})).toBeInstanceOf(FakeGateway);
    expect(createGateway({ SANKHYA_MODE: 'fake' })).toBeInstanceOf(FakeGateway);
    expect(createGateway({ SANKHYA_MODE: '  ' })).toBeInstanceOf(FakeGateway);
  });

  it('never goes live implicitly, and rejects unknown modes', () => {
    expect(createGateway({ SANKHYA_BASE_URL: `https://${TEST_HOST}`, SANKHYA_CLIENT_ID: 'x' })).toBeInstanceOf(FakeGateway);
    expect(problemsOf({ SANKHYA_MODE: 'prod' })).toEqual(["SANKHYA_MODE must be 'fake' (default) or 'live'."]);
  });

  it('builds the real read-only gateway only with everything explicit', () => {
    const gateway = createGateway(LIVE_ENV, { transport: () => Promise.reject(new Error('never called')) });
    expect(gateway).toBeInstanceOf(RealSankhyaGateway);
    expect(gateway.describe()).toMatchObject({ mode: 'live', environmentKind: 'sandbox', host: TEST_HOST });
  });

  it('lists every missing piece at once, by variable name only', () => {
    const problems = problemsOf({ SANKHYA_MODE: 'live' }).join('\n');
    for (const name of ['SANKHYA_ALLOWED_HOSTS', 'SANKHYA_BASE_URL', 'SANKHYA_ENVIRONMENT', 'SANKHYA_CLIENT_ID', 'SANKHYA_CLIENT_SECRET', 'SANKHYA_X_TOKEN']) {
      expect(problems).toContain(name);
    }
  });

  it('refuses live mode without an allow-list (no default)', () => {
    const { SANKHYA_ALLOWED_HOSTS: _omitted, ...env } = LIVE_ENV;
    void _omitted;
    expect(problemsOf(env).join('\n')).toContain('SANKHYA_ALLOWED_HOSTS');
  });

  it('refuses a base URL whose host is not allow-listed, without echoing it', () => {
    const problems = problemsOf({ ...LIVE_ENV, SANKHYA_BASE_URL: 'https://not-listed.example.test' });
    expect(problems.join('\n')).toContain('not listed in SANKHYA_ALLOWED_HOSTS');
    expect(problems.join('\n')).not.toContain('not-listed');
  });

  it('refuses production, whatever else is set (SNK-3, U-03)', () => {
    const problems = problemsOf({ ...LIVE_ENV, SANKHYA_ENVIRONMENT: 'production' });
    expect(problems.join('\n')).toMatch(/production is refused/);
  });

  it('never echoes credential values in problems', () => {
    const problems = problemsOf({ ...LIVE_ENV, SANKHYA_ENVIRONMENT: 'nonsense', SANKHYA_PAGE_SIZE: 'abc' }).join('\n');
    for (const secret of Object.values(TEST_CREDENTIALS)) expect(problems).not.toContain(secret);
  });

  it('validates the optional numeric settings', () => {
    const problems = problemsOf({ ...LIVE_ENV, SANKHYA_PAGE_SIZE: '5000', SANKHYA_REQUEST_TIMEOUT_MS: '5', SANKHYA_DB_UTC_OFFSET_MINUTES: 'x' }).join('\n');
    expect(problems).toContain('SANKHYA_PAGE_SIZE');
    expect(problems).toContain('SANKHYA_REQUEST_TIMEOUT_MS');
    expect(problems).toContain('SANKHYA_DB_UTC_OFFSET_MINUTES');
  });

  it('requires a validator when SF_CONFIG_FILE is set', () => {
    expect(problemsOf({ ...LIVE_ENV, SF_CONFIG_FILE: '/tmp/config.json' }).join('\n')).toContain('SF_CONFIG_FILE');
  });

  it('reads the configuration through the bootstrap file when SF_CONFIG_FILE is set', async () => {
    const gateway = createGateway(
      { ...LIVE_ENV, SF_CONFIG_FILE: 'config.json' },
      {
        transport: () => Promise.reject(new Error('never called')),
        readConfigurationText: () => Promise.resolve('{"schemaVersion":1}'),
        validateConfiguration: (raw) => ({ ok: true, value: raw as never }),
        now: () => Date.parse('2026-09-18T00:00:00.000Z'),
      },
    );
    expect(gateway.describe().capabilities.reads.configuration).toBe('supported');
    const configuration = await gateway.readConfiguration();
    expect(configuration.source).toMatchObject({ kind: 'bootstrap-file', syncedAt: '2026-09-18T00:00:00.000Z' });
  });

  it('a factory-built live gateway works end to end over an injected transport', async () => {
    const clock = { now: 1_800_000_000_000 };
    const mock = new MockSankhya({ tables: erpTablesFromDataset(getDemoDataset()), clock });
    const gateway = createGateway(LIVE_ENV, { transport: mock.transport, now: () => clock.now });
    const rows: unknown[] = [];
    for await (const batch of gateway.readSellers()) rows.push(...batch);
    expect(rows).toHaveLength(12);
  });
});
