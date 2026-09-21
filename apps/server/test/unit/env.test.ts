import { Secret } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '../../src/config/api-env.js';
import { EnvValidationError, withoutEmptyValues } from '../../src/config/env.js';
import { loadWorkerConfig } from '../../src/config/worker-env.js';

const DATABASE_URL = 'postgres://user:hunter2-not-a-real-password@127.0.0.1:5432/db';

function problemsOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected an EnvValidationError');
}

describe('API environment', () => {
  it('applies defaults and wraps the connection string in a Secret', () => {
    const env = parseApiEnv({ DATABASE_URL });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_HOST: '127.0.0.1',
      API_PORT: 3000,
      DB_POOL_MAX: 10,
      AUTH_MODE: 'dev',
    });
    expect(env.DATABASE_URL).toBeInstanceOf(Secret);
    expect(JSON.stringify(env)).not.toContain('hunter2');
  });

  it('treats an empty variable as unset', () => {
    expect(parseApiEnv({ DATABASE_URL, API_PORT: '', LOG_LEVEL: '  ' }).API_PORT).toBe(3000);
    expect(withoutEmptyValues({ A: '', B: ' x ', C: undefined })).toEqual({ B: 'x' });
  });

  it('reports every problem at once, by variable name, without echoing values', () => {
    const secretish = 'not-a-url-but-looks-like-hunter2';
    const problems = problemsOf(() =>
      parseApiEnv({ DATABASE_URL: secretish, API_PORT: '99999', LOG_LEVEL: 'shout', DB_POOL_MAX: '0' }),
    );
    expect(problems.map((problem) => problem.split(':')[0]).sort()).toEqual(
      ['API_PORT', 'DATABASE_URL', 'DB_POOL_MAX', 'LOG_LEVEL'],
    );
    expect(problems.join('\n')).not.toContain(secretish);
    expect(problems.join('\n')).not.toContain('99999');
  });

  it('requires DATABASE_URL', () => {
    expect(problemsOf(() => parseApiEnv({}))).toEqual([expect.stringMatching(/^DATABASE_URL: /)]);
  });

  it('refuses AUTH_MODE=dev in production', () => {
    expect(problemsOf(() => parseApiEnv({ DATABASE_URL, NODE_ENV: 'production' }))).toEqual([
      expect.stringMatching(/^AUTH_MODE: .*production/),
    ]);
  });

  it('never reads SANKHYA_* (a stray credential is ignored, not parsed)', () => {
    const env = parseApiEnv({
      DATABASE_URL,
      SANKHYA_MODE: 'not-even-valid',
      SANKHYA_CLIENT_SECRET: 'stray-credential-value',
    });
    expect(JSON.stringify(env)).not.toContain('stray-credential-value');
    expect(Object.keys(env).some((key) => key.startsWith('SANKHYA'))).toBe(false);
  });
});

describe('Worker environment', () => {
  it('defaults to the synthetic fake gateway and never exposes credentials', () => {
    const config = loadWorkerConfig({ DATABASE_URL });
    expect(config.gatewayDescription.mode).toBe('fake');
    expect(config.env).toMatchObject({
      WORKER_HEALTH_HOST: '127.0.0.1',
      WORKER_HEALTH_PORT: 3001,
      HEARTBEAT_CRON: '* * * * *',
      WORKER_SHUTDOWN_TIMEOUT_MS: 30_000,
    });
    expect(JSON.stringify(config)).not.toContain('hunter2');
  });

  it('aggregates server and gateway problems in one error, without values', () => {
    const problems = problemsOf(() =>
      loadWorkerConfig({
        DATABASE_URL: 'nope',
        HEARTBEAT_CRON: 'every minute',
        SANKHYA_MODE: 'live',
        SANKHYA_CLIENT_SECRET: 'leaky-secret-value',
      }),
    );
    const text = problems.join('\n');
    expect(text).toContain('DATABASE_URL');
    expect(text).toContain('HEARTBEAT_CRON');
    expect(text).toMatch(/SANKHYA_/);
    expect(text).not.toContain('leaky-secret-value');
  });

  it('rejects an unknown gateway mode', () => {
    expect(problemsOf(() => loadWorkerConfig({ DATABASE_URL, SANKHYA_MODE: 'turbo' })).join('\n')).toMatch(
      /SANKHYA_MODE/,
    );
  });
});
