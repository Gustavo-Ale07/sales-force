import { Secret } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '../../src/config/api-env.js';
import { EnvValidationError, isLoopbackDatabaseUrl, withoutEmptyValues } from '../../src/config/env.js';
import { loadWorkerConfig } from '../../src/config/worker-env.js';

const DATABASE_URL = 'postgres://user:hunter2-not-a-real-password@127.0.0.1:5432/db';
/** The minimum a development API needs: NODE_ENV has no default and dev auth needs the opt-in. */
const DEV = { DATABASE_URL, NODE_ENV: 'development', ALLOW_DEV_AUTH: '1' } as const;

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
    const env = parseApiEnv({ ...DEV });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_HOST: '127.0.0.1',
      API_PORT: 3000,
      DB_POOL_MAX: 10,
      AUTH_MODE: 'dev',
      TRUST_PROXY: false,
      SESSION_IDLE_TIMEOUT_MINUTES: 720,
      SESSION_ABSOLUTE_TIMEOUT_HOURS: 168,
      PASSWORD_HASH_MEMORY_KIB: 19_456,
      PASSWORD_HASH_TIME_COST: 2,
      PASSWORD_HASH_PARALLELISM: 1,
    });
    expect(env.allowedOrigins).toContain('http://localhost:5173');
    expect(env.DATABASE_URL).toBeInstanceOf(Secret);
    expect(JSON.stringify(env)).not.toContain('hunter2');
  });

  it('treats an empty variable as unset', () => {
    expect(parseApiEnv({ ...DEV, API_PORT: '', LOG_LEVEL: '  ' }).API_PORT).toBe(3000);
    expect(withoutEmptyValues({ A: '', B: ' x ', C: undefined })).toEqual({ B: 'x' });
  });

  it('reports every problem at once, by variable name, without echoing values', () => {
    const secretish = 'not-a-url-but-looks-like-hunter2';
    const problems = problemsOf(() =>
      parseApiEnv({ ...DEV, DATABASE_URL: secretish, API_PORT: '99999', LOG_LEVEL: 'shout', DB_POOL_MAX: '0' }),
    );
    expect(problems.map((problem) => problem.split(':')[0]).sort()).toEqual(
      ['API_PORT', 'DATABASE_URL', 'DB_POOL_MAX', 'LOG_LEVEL'],
    );
    expect(problems.join('\n')).not.toContain(secretish);
    expect(problems.join('\n')).not.toContain('99999');
  });

  it('requires DATABASE_URL and NODE_ENV (no default for either)', () => {
    expect(problemsOf(() => parseApiEnv({})).map((problem) => problem.split(':')[0]).sort()).toEqual([
      'DATABASE_URL',
      'NODE_ENV',
    ]);
  });

  it('fails closed when NODE_ENV is missing or unknown: development guards are never assumed', () => {
    expect(problemsOf(() => parseApiEnv({ DATABASE_URL, ALLOW_DEV_AUTH: '1' }))).toEqual([
      expect.stringMatching(/^NODE_ENV: is required/),
    ]);
    expect(problemsOf(() => parseApiEnv({ DATABASE_URL, ALLOW_DEV_AUTH: '1', NODE_ENV: 'prod' }))).toEqual([
      expect.stringMatching(/^NODE_ENV: /),
    ]);
  });

  it('refuses AUTH_MODE=dev in production, even with the opt-in', () => {
    expect(problemsOf(() => parseApiEnv({ DATABASE_URL, NODE_ENV: 'production', TRUST_PROXY: '1', ALLOW_DEV_AUTH: '1', ALLOWED_ORIGINS: 'https://app.example.com' }))).toEqual([
      expect.stringMatching(/^AUTH_MODE: .*production/),
    ]);
  });

  it('refuses the dev auth mode without the explicit ALLOW_DEV_AUTH=1 opt-in', () => {
    const problems = problemsOf(() => parseApiEnv({ DATABASE_URL, NODE_ENV: 'development' }));
    expect(problems).toEqual([expect.stringMatching(/^ALLOW_DEV_AUTH: /)]);
    expect(problemsOf(() => parseApiEnv({ DATABASE_URL, NODE_ENV: 'test', ALLOW_DEV_AUTH: 'true' }))).toEqual([
      expect.stringMatching(/^ALLOW_DEV_AUTH: /),
    ]);
    expect(parseApiEnv({ DATABASE_URL, NODE_ENV: 'test', ALLOW_DEV_AUTH: '1' }).AUTH_MODE).toBe('dev');
  });

  it('requires ALLOWED_ORIGINS in production and validates the origin format', () => {
    expect(
      problemsOf(() => parseApiEnv({ DATABASE_URL, NODE_ENV: 'production', ALLOW_DEV_AUTH: '1' })).some((problem) =>
        problem.startsWith('ALLOWED_ORIGINS'),
      ),
    ).toBe(true);
    expect(problemsOf(() => parseApiEnv({ ...DEV, ALLOWED_ORIGINS: 'https://app.example.com/path' }))).toEqual([
      expect.stringMatching(/^ALLOWED_ORIGINS: /),
    ]);
    expect(parseApiEnv({ ...DEV, ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com' }).allowedOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('refuses Argon2id parameters below the OWASP floor in production only', () => {
    const production = { DATABASE_URL, NODE_ENV: 'production', ALLOW_DEV_AUTH: '1', ALLOWED_ORIGINS: 'https://app.example.com' };
    const problems = problemsOf(() => parseApiEnv({ ...production, PASSWORD_HASH_MEMORY_KIB: '1024', PASSWORD_HASH_TIME_COST: '1' }));
    expect(problems.filter((problem) => problem.startsWith('PASSWORD_HASH'))).toHaveLength(2);
    expect(parseApiEnv({ ...DEV, PASSWORD_HASH_MEMORY_KIB: '1024', PASSWORD_HASH_TIME_COST: '1' }).PASSWORD_HASH_MEMORY_KIB).toBe(1024);
  });

  it('parses TRUST_PROXY as nothing, a hop count or an address list; never as "trust everything"', () => {
    expect(parseApiEnv({ ...DEV }).TRUST_PROXY).toBe(false);
    expect(parseApiEnv({ ...DEV, TRUST_PROXY: '0' }).TRUST_PROXY).toBe(false);
    expect(parseApiEnv({ ...DEV, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(parseApiEnv({ ...DEV, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1, ::1' }).TRUST_PROXY).toEqual(['10.0.0.0/8', '127.0.0.1', '::1']);
    for (const bad of ['true', 'yes', '*', '10.0.0.1; drop']) {
      expect(problemsOf(() => parseApiEnv({ ...DEV, TRUST_PROXY: bad }))).toEqual([expect.stringMatching(/^TRUST_PROXY: /)]);
    }
  });

  it('never reads SANKHYA_* (a stray credential is ignored, not parsed)', () => {
    const env = parseApiEnv({
      ...DEV,
      SANKHYA_MODE: 'not-even-valid',
      SANKHYA_CLIENT_SECRET: 'stray-credential-value',
    });
    expect(JSON.stringify(env)).not.toContain('stray-credential-value');
    expect(Object.keys(env).some((key) => key.startsWith('SANKHYA'))).toBe(false);
  });
});

describe('loopback database guard (seed and account CLI)', () => {
  it('accepts loopback hosts only', () => {
    for (const url of [
      'postgres://u:p@localhost:5432/db',
      'postgres://u:p@127.0.0.1:55432/db',
      'postgres://u:p@127.10.0.3/db',
      'postgres://u:p@[::1]:5432/db',
    ]) {
      expect(isLoopbackDatabaseUrl(url)).toBe(true);
    }
    for (const url of [
      'postgres://u:p@db.internal.example.com:5432/db',
      'postgres://u:p@10.0.0.5/db',
      'postgres://u:p@127.0.0.1.evil.example.com/db',
      'postgres://u:p@localhost.evil.example.com/db',
      'not a url',
    ]) {
      expect(isLoopbackDatabaseUrl(url)).toBe(false);
    }
  });
});

describe('Worker environment', () => {
  const WORKER = { DATABASE_URL, NODE_ENV: 'development' } as const;

  it('defaults to the synthetic fake gateway and never exposes credentials', () => {
    const config = loadWorkerConfig({ ...WORKER });
    expect(config.gatewayDescription.mode).toBe('fake');
    expect(config.env).toMatchObject({
      WORKER_HEALTH_HOST: '127.0.0.1',
      WORKER_HEALTH_PORT: 3001,
      HEARTBEAT_CRON: '* * * * *',
      WORKER_SHUTDOWN_TIMEOUT_MS: 30_000,
    });
    expect(JSON.stringify(config)).not.toContain('hunter2');
  });

  it('requires NODE_ENV (no default)', () => {
    expect(problemsOf(() => loadWorkerConfig({ DATABASE_URL }))).toEqual([expect.stringMatching(/^NODE_ENV: is required/)]);
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
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, SANKHYA_MODE: 'turbo' })).join('\n')).toMatch(/SANKHYA_MODE/);
  });
});
