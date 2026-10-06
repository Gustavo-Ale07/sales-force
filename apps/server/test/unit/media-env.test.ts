import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '../../src/config/api-env.js';
import { EnvValidationError } from '../../src/config/env.js';
import { loadWorkerConfig } from '../../src/config/worker-env.js';

const DATABASE_URL = 'postgres://user:not-a-real-password@127.0.0.1:5432/db';
const DIR = tmpdir(); // absolute on every platform
const WORKER = { DATABASE_URL, NODE_ENV: 'development' } as const;
const API = { DATABASE_URL, NODE_ENV: 'development', ALLOW_DEV_AUTH: '1' } as const;

function problemsOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems.join('\n');
    throw error;
  }
  throw new Error('expected an EnvValidationError');
}

describe('worker product media configuration', () => {
  it('is disabled by default with documented defaults', () => {
    const { env } = loadWorkerConfig({ ...WORKER });
    expect(env).toMatchObject({
      PRODUCT_MEDIA_SYNC_ENABLED: false,
      PRODUCT_MEDIA_MAX_BYTES: 5 * 1024 * 1024,
      PRODUCT_MEDIA_SYNC_CRON: '30 3 * * *',
      PRODUCT_MEDIA_SYNC_CONCURRENCY: 2,
      PRODUCT_MEDIA_VERIFY_OBJECTS: true,
    });
    expect(env.PRODUCT_MEDIA_DIR).toBeUndefined();
  });

  it('fails fast when enabled without a directory', () => {
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, PRODUCT_MEDIA_SYNC_ENABLED: 'true' }))).toMatch(/PRODUCT_MEDIA_DIR: is required/);
  });

  it('accepts enabled with an absolute directory', () => {
    const { env } = loadWorkerConfig({ ...WORKER, PRODUCT_MEDIA_SYNC_ENABLED: 'true', PRODUCT_MEDIA_DIR: DIR });
    expect(env.PRODUCT_MEDIA_SYNC_ENABLED).toBe(true);
    expect(env.PRODUCT_MEDIA_DIR).toBe(DIR);
  });

  it('refuses a relative directory and invalid scalars, without echoing values', () => {
    const text = problemsOf(() =>
      loadWorkerConfig({
        ...WORKER,
        PRODUCT_MEDIA_DIR: 'relative/photos',
        PRODUCT_MEDIA_SYNC_ENABLED: 'yes',
        PRODUCT_MEDIA_SYNC_CRON: 'daily',
        PRODUCT_MEDIA_SYNC_CONCURRENCY: '99',
        PRODUCT_MEDIA_MAX_BYTES: '10',
      }),
    );
    expect(text).toMatch(/PRODUCT_MEDIA_SYNC_ENABLED/);
    expect(text).toMatch(/PRODUCT_MEDIA_SYNC_CRON/);
    expect(text).toMatch(/PRODUCT_MEDIA_SYNC_CONCURRENCY/);
    expect(text).toMatch(/PRODUCT_MEDIA_MAX_BYTES/);
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, PRODUCT_MEDIA_DIR: 'relative/photos' }))).toMatch(/absolute/);
    expect(text).not.toContain('relative/photos');
  });
});

describe('worker product media fake-gateway opt-in and failure limit', () => {
  it('defaults to no fake-gateway storage and a limit of 3', () => {
    expect(loadWorkerConfig({ ...WORKER }).env).toMatchObject({
      PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY: false,
      PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT: 3,
    });
  });

  it('reads the opt-in and the limit, and refuses invalid values', () => {
    expect(loadWorkerConfig({ ...WORKER, PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY: 'true', PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT: '5' }).env).toMatchObject({
      PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY: true,
      PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT: 5,
    });
    const text = problemsOf(() => loadWorkerConfig({ ...WORKER, PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY: 'yes', PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT: '0' }));
    expect(text).toMatch(/PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY/);
    expect(text).toMatch(/PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT/);
  });

  it('in production the opt-in is refused unless the worker already allows the fake gateway', () => {
    const production = { ...WORKER, NODE_ENV: 'production', SANKHYA_MODE: 'fake', PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY: 'true' };
    expect(problemsOf(() => loadWorkerConfig(production))).toMatch(/PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY: is only honoured/);
  });
});

describe('API product media configuration', () => {
  it('has no directory by default (no product has an image) and documented caps', () => {
    const env = parseApiEnv({ ...API });
    expect(env.PRODUCT_MEDIA_DIR).toBeUndefined();
    expect(env.PRODUCT_MEDIA_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(env.PRODUCT_MEDIA_THUMB_MAX_BYTES).toBe(256 * 1024);
  });

  it('refuses a thumbnail cap below the renderer bound (262144), accepts the bound and above', () => {
    expect(problemsOf(() => parseApiEnv({ ...API, PRODUCT_MEDIA_THUMB_MAX_BYTES: '262143' }))).toMatch(/PRODUCT_MEDIA_THUMB_MAX_BYTES: must be an integer between 262144/);
    expect(problemsOf(() => parseApiEnv({ ...API, PRODUCT_MEDIA_THUMB_MAX_BYTES: '1024' }))).toMatch(/PRODUCT_MEDIA_THUMB_MAX_BYTES/);
    expect(parseApiEnv({ ...API, PRODUCT_MEDIA_THUMB_MAX_BYTES: '262144' }).PRODUCT_MEDIA_THUMB_MAX_BYTES).toBe(262144);
    expect(parseApiEnv({ ...API, PRODUCT_MEDIA_THUMB_MAX_BYTES: '524288' }).PRODUCT_MEDIA_THUMB_MAX_BYTES).toBe(524288);
  });

  it('reads the directory and refuses a relative one', () => {
    expect(parseApiEnv({ ...API, PRODUCT_MEDIA_DIR: DIR }).PRODUCT_MEDIA_DIR).toBe(DIR);
    expect(problemsOf(() => parseApiEnv({ ...API, PRODUCT_MEDIA_DIR: './photos' }))).toMatch(/PRODUCT_MEDIA_DIR: must be an absolute path/);
  });
});
