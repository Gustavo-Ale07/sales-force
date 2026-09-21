import { SankhyaGatewayError } from '@salesforce/sankhya';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '../../src/config/api-env.js';
import { EnvValidationError, isLoopbackDatabaseUrl } from '../../src/config/env.js';
import { loadWorkerConfig } from '../../src/config/worker-env.js';
import { operatorIdentity } from '../../src/cli/operator-identity.js';
import { AuditSampler } from '../../src/iam/audit-sampler.js';
import { throttleAddress } from '../../src/iam/client-address.js';
import { readCookie } from '../../src/iam/cookies.js';
import { HashLimiter } from '../../src/iam/hash-limiter.js';
import { Argon2idPasswordHasher } from '../../src/iam/password-hasher.js';
import { ipThrottleKey } from '../../src/iam/session-crypto.js';
import { createLogger, errorLogFields, maskUris } from '../../src/observability/logger.js';
import { applyPoolLimits } from '../../src/platform/pool-limits.js';
import { describeSyncFailure } from '../../src/sync/failure.js';
import { PermanentJobError } from '../../src/worker/job-contract.js';
import { TEST_HASH_PARAMS } from '../helpers/auth.js';
import { captureLogs } from '../helpers/postgres.js';

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

describe('client address throttle key (A1: IPv6 aggregated by /64)', () => {
  it('keeps IPv4 addresses and unwraps IPv4-mapped IPv6', () => {
    expect(throttleAddress('203.0.113.9')).toBe('203.0.113.9');
    expect(throttleAddress('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(throttleAddress('::ffff:cb00:7109')).toBe('203.0.113.9');
  });

  it('maps every address of one /64 to the same key, and different /64s to different keys', () => {
    const a = throttleAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(throttleAddress('2001:DB8:1:2::1')).toBe(a);
    expect(throttleAddress('2001:db8:1:2:0:0:0:ffff')).toBe(a);
    expect(throttleAddress('2001:db8:1:3::1')).not.toBe(a);
    expect(throttleAddress('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(throttleAddress('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('feeds the throttle key and never yields an unbounded string', () => {
    expect(ipThrottleKey('2001:db8:1:2:9:9:9:9')).toBe('ip:2001:db8:1:2::/64');
    expect(throttleAddress('x'.repeat(500)).length).toBeLessThanOrEqual(64);
  });
});

describe('hash limiter (A1: bounded concurrent Argon2id work)', () => {
  it('grants at most `max` slots and frees one on release (release is idempotent)', () => {
    const limiter = new HashLimiter(2);
    const first = limiter.tryAcquire();
    const second = limiter.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(limiter.tryAcquire()).toBeNull();
    first?.();
    first?.();
    expect(limiter.inFlight).toBe(1);
    expect(limiter.tryAcquire()).not.toBeNull();
    expect(limiter.tryAcquire()).toBeNull();
  });
});

describe('session cookie parsing (A6: duplicates are ignored, never picked)', () => {
  it('ignores every occurrence when the cookie is repeated, in one header or several', () => {
    expect(readCookie('sf_session=aaa; sf_session=bbb', 'sf_session')).toBeUndefined();
    expect(readCookie(['sf_session=aaa', 'x=1; sf_session=bbb'], 'sf_session')).toBeUndefined();
    expect(readCookie('sf_session=aaa; sf_session=aaa', 'sf_session')).toBeUndefined();
    expect(readCookie('a=1; sf_session=aaa; b=2', 'sf_session')).toBe('aaa');
  });
});

describe('Argon2id dummy hash (A5)', () => {
  it('is computed once at warm-up: an unknown-user verify afterwards does not hash again', async () => {
    const hasher = new Argon2idPasswordHasher(TEST_HASH_PARAMS);
    let hashCalls = 0;
    const original = hasher.hash.bind(hasher);
    hasher.hash = (password: string) => {
      hashCalls += 1;
      return original(password);
    };
    await hasher.warmUp();
    expect(hashCalls).toBe(1);
    expect(await hasher.verify(null, 'whatever')).toBe(false);
    expect(await hasher.verify(null, 'whatever-else')).toBe(false);
    expect(hashCalls).toBe(1);
  });
});

describe('logging (A9: error allowlist, URI masking)', () => {
  it('serializes only allow-listed error properties (no PG detail/where, no config objects)', () => {
    const capture = captureLogs();
    const logger = createLogger({ level: 'info', service: 'api', destination: capture.stream });
    const dbError = Object.assign(new Error('duplicate key value violates unique constraint "u_idx"'), {
      code: '23505',
      constraint: 'u_idx',
      table: 'customer',
      detail: 'Key (email)=(secret-person@example.test) already exists.',
      where: 'SQL statement "INSERT ... VALUES (secret-person@example.test)"',
      hint: 'a hint',
      routine: '_bt_check_unique',
      config: { password: 'pw-in-config-1' },
      request: { headers: { authorization: 'Bearer abc' } },
    });
    logger.error({ err: dbError }, 'failed');
    const [line] = capture.lines();
    const text = JSON.stringify(line);
    expect(text).not.toContain('secret-person@example.test');
    expect(text).not.toContain('pw-in-config-1');
    expect(text).not.toContain('_bt_check_unique');
    expect(line?.['err']).toMatchObject({ type: 'Error', code: '23505', constraint: 'u_idx', table: 'customer' });
    expect(line?.['err']).not.toHaveProperty('detail');
    expect(line?.['err']).not.toHaveProperty('where');
    expect(line?.['err']).not.toHaveProperty('config');
  });

  it('masks URIs and connection strings in messages, stacks and causes', () => {
    const capture = captureLogs();
    const logger = createLogger({ level: 'info', service: 'api', destination: capture.stream });
    const inner = new Error('connect failed for postgres://svc:inner-pw-77@db.internal:5432/app');
    const outer = new Error('wrapped https://user:outer-pw-88@host.example/path?token=abc', { cause: inner });
    logger.error({ err: outer }, 'failed');
    logger.info(`plain message with postgres://u:msg-pw-99@h/db inside`);
    const text = JSON.stringify(capture.lines());
    for (const leaked of ['inner-pw-77', 'outer-pw-88', 'msg-pw-99', 'token=abc']) expect(text).not.toContain(leaked);
    expect(maskUris('see https://a:b@c.example/x?y=1 now')).toBe('see https://[redacted] now');
  });

  it('errorLogFields keeps only class, code, constraint and table for unknown errors', () => {
    const pgError = Object.assign(new Error('invalid input syntax for type uuid: "secret-value"'), {
      code: '22P02',
      constraint: 'c',
      table: 't',
      detail: 'secret detail',
      where: 'secret where',
    });
    const fields = errorLogFields(pgError);
    expect(fields).toEqual({ errorName: 'Error', code: '22P02', constraint: 'c', table: 't' });
    expect(JSON.stringify(fields)).not.toContain('secret');
    // Job errors and gateway errors are secret-free by contract: their message stays.
    expect(errorLogFields(new PermanentJobError('bad payload'))).toMatchObject({ message: 'bad payload' });
    expect(errorLogFields(new SankhyaGatewayError('auth', { code: 'x', message: 'clean' }))).toMatchObject({ message: 'clean' });
    expect(errorLogFields('a string')).toEqual({ errorName: 'NonError' });
  });
});

describe('sync_state.lastErrorMessage (A11)', () => {
  it('stores class and a sanitized code only for an unknown error, never attacker/driver text', () => {
    const failure = describeSyncFailure(
      Object.assign(new Error('secret driver text'), { code: 'weird code with spaces and postgres://u:pw@h/db' }),
    );
    expect(failure.errorCode).toBeNull();
    expect(failure.message).not.toMatch(/secret|postgres|pw@/);
    const pgFailure = describeSyncFailure(Object.assign(new Error('x'), { code: '23505', detail: 'Key (a)=(secret)' }));
    expect(pgFailure.errorCode).toBe('23505');
    expect(pgFailure.message).not.toContain('secret');
  });
});

describe('TRUST_PROXY (A3)', () => {
  const PROD = { DATABASE_URL, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://app.example.com' } as const;

  it('is required, explicitly, when NODE_ENV=production', () => {
    // Production has no authentication mode yet (only `dev` exists and it is refused there), so the
    // parse always fails in production today: the assertion is on the TRUST_PROXY problem alone.
    const trustProblems = (env: Record<string, string>) =>
      problemsOf(() => parseApiEnv(env)).filter((problem) => problem.startsWith('TRUST_PROXY'));
    expect(trustProblems({ ...PROD })).toEqual([expect.stringMatching(/^TRUST_PROXY: is required when NODE_ENV=production/)]);
    expect(trustProblems({ ...PROD, TRUST_PROXY: '' })).toHaveLength(1);
    expect(trustProblems({ ...PROD, TRUST_PROXY: '1' })).toEqual([]);
    expect(trustProblems({ ...PROD, TRUST_PROXY: '0' })).toEqual([]);
    expect(trustProblems({ ...PROD, TRUST_PROXY: '10.0.0.0/8' })).toEqual([]);
  });

  it('keeps the default (nobody trusted) outside production', () => {
    expect(parseApiEnv({ DATABASE_URL, NODE_ENV: 'development', ALLOW_DEV_AUTH: '1' }).TRUST_PROXY).toBe(false);
  });
});

describe('database limits and login budget env (A1, A7)', () => {
  const DEV = { DATABASE_URL, NODE_ENV: 'development', ALLOW_DEV_AUTH: '1' } as const;

  it('has bounded defaults and validates ranges', () => {
    expect(parseApiEnv({ ...DEV })).toMatchObject({
      DB_CONNECTION_TIMEOUT_MS: 5000,
      DB_STATEMENT_TIMEOUT_MS: 15_000,
      LOGIN_MAX_CONCURRENT_HASHES: 4,
      LOGIN_GLOBAL_MAX_PER_MINUTE: 300,
    });
    const problems = problemsOf(() => parseApiEnv({ ...DEV, DB_STATEMENT_TIMEOUT_MS: '0', LOGIN_MAX_CONCURRENT_HASHES: '0' }));
    expect(problems.map((p) => p.split(':')[0]).sort()).toEqual(['DB_STATEMENT_TIMEOUT_MS', 'LOGIN_MAX_CONCURRENT_HASHES']);
  });
});

describe('pool limits (A7)', () => {
  it('sets a connection timeout and a server-side statement timeout on the pool options', () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    applyPoolLimits(pool, { connectionTimeoutMs: 4321, statementTimeoutMs: 8765 });
    expect(pool.options.connectionTimeoutMillis).toBe(4321);
    expect((pool.options as { statement_timeout?: number }).statement_timeout).toBe(8765);
    void pool.end();
  });
});

describe('database target guard (A4: seed and account CLI)', () => {
  it('rejects host, hostaddr, port and service overrides in the query string, in any case', () => {
    for (const url of [
      'postgres://u:p@127.0.0.1/db?host=db.internal.example.com',
      'postgres://u:p@localhost/db?hostaddr=10.0.0.5',
      'postgres://u:p@localhost/db?HOST=/var/run/postgresql',
      'postgres://u:p@localhost/db?port=6432',
      'postgres://u:p@localhost/db?service=prod',
      'postgres://u:p@localhost/db?sslmode=disable&Service=prod',
    ]) {
      expect(isLoopbackDatabaseUrl(url), url).toBe(false);
    }
    expect(isLoopbackDatabaseUrl('postgres://u:p@localhost:5432/db?sslmode=disable&application_name=x')).toBe(true);
  });

  it('rejects multi-host, host-less and userinfo-disguised URLs', () => {
    for (const url of [
      'postgres://u:p@127.0.0.1,db.example.com/db',
      'postgres:///db',
      'postgres://127.0.0.1@db.example.com/db',
      'postgres://u:p@[::1]:5432,db.example.com/db',
    ]) {
      expect(isLoopbackDatabaseUrl(url), url).toBe(false);
    }
  });
});

describe('Worker environment (L1, A8, SYNC_MIRROR_ENABLED)', () => {
  const WORKER = { DATABASE_URL, NODE_ENV: 'development' } as const;

  it('accepts a valid SYNC_CRON_* override and rejects an invalid one (cron regex keeps its backslashes)', () => {
    const config = loadWorkerConfig({ ...WORKER, SYNC_CRON_SELLERS: '*/15 * * * *', SYNC_CRON_PRICES: '0 3 * * 1-5' });
    expect(config.env.SYNC_CRON_SELLERS).toBe('*/15 * * * *');
    expect(config.env.SYNC_CRON_PRICES).toBe('0 3 * * 1-5');
    for (const bad of ['every minute', '* * * *', '* * * * * *', 'SSSS']) {
      expect(problemsOf(() => loadWorkerConfig({ ...WORKER, SYNC_CRON_CUSTOMERS: bad })).join('\n')).toMatch(/SYNC_CRON_CUSTOMERS/);
    }
  });

  it('binds the health endpoint to loopback unless the override is explicit', () => {
    expect(loadWorkerConfig({ ...WORKER, WORKER_HEALTH_HOST: '::1' }).env.WORKER_HEALTH_HOST).toBe('::1');
    expect(loadWorkerConfig({ ...WORKER, WORKER_HEALTH_HOST: 'localhost' }).env.WORKER_HEALTH_HOST).toBe('localhost');
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, WORKER_HEALTH_HOST: '0.0.0.0' })).join('\n')).toMatch(/WORKER_HEALTH_HOST: .*loopback/);
    expect(
      loadWorkerConfig({ ...WORKER, WORKER_HEALTH_HOST: '0.0.0.0', WORKER_HEALTH_ALLOW_NON_LOOPBACK: '1' }).env.WORKER_HEALTH_HOST,
    ).toBe('0.0.0.0');
  });

  it('keeps SYNC_MIRROR_ENABLED defaulting to true for the fake gateway, but demands it explicitly for live', () => {
    expect(loadWorkerConfig({ ...WORKER }).env.SYNC_MIRROR_ENABLED).toBe(true);
    const live = {
      ...WORKER,
      SANKHYA_MODE: 'live',
      SANKHYA_BASE_URL: 'https://sandbox.example.test',
      SANKHYA_ALLOWED_HOSTS: 'sandbox.example.test',
      SANKHYA_ENVIRONMENT: 'sandbox',
      SANKHYA_CLIENT_ID: 'placeholder-id',
      SANKHYA_CLIENT_SECRET: 'placeholder-secret',
      SANKHYA_X_TOKEN: 'placeholder-token',
    };
    const problems = problemsOf(() => loadWorkerConfig(live));
    expect(problems.join('\n')).toMatch(/SYNC_MIRROR_ENABLED: .*explicit.*live/);
    expect(problems.join('\n')).not.toContain('placeholder-secret');
    expect(loadWorkerConfig({ ...live, SYNC_MIRROR_ENABLED: 'false' }).env.SYNC_MIRROR_ENABLED).toBe(false);
  });
});

describe('operator attribution (A10)', () => {
  it('uses OPERATOR when given, otherwise the OS user, and refuses odd characters', () => {
    expect(operatorIdentity({ OPERATOR: 'maria.silva' }, () => 'osuser')).toBe('maria.silva');
    expect(operatorIdentity({}, () => 'osuser')).toBe('os:osuser');
    expect(operatorIdentity({ OPERATOR: '   ' }, () => 'osuser')).toBe('os:osuser');
    expect(() => operatorIdentity({ OPERATOR: 'bad\nvalue' }, () => 'osuser')).toThrow(/OPERATOR/);
    expect(() => operatorIdentity({ OPERATOR: 'x'.repeat(65) }, () => 'osuser')).toThrow(/OPERATOR/);
  });
});

describe('audit sampler (A2: a flood writes O(log n) audit rows)', () => {
  it('records the 1st, 2nd, 4th, 8th... occurrence per scope and window, and restarts with the window', () => {
    const sampler = new AuditSampler(60_000);
    const t0 = new Date('2026-09-21T12:00:00.000Z');
    const recorded: number[] = [];
    for (let i = 1; i <= 100; i += 1) {
      const outcome = sampler.observe('ip', t0);
      if (outcome.record) recorded.push(outcome.count);
    }
    expect(recorded).toEqual([1, 2, 4, 8, 16, 32, 64]);
    // Another scope is independent; a new window starts over.
    expect(sampler.observe('account', t0)).toEqual({ record: true, count: 1 });
    expect(sampler.observe('ip', new Date(t0.getTime() + 60_000))).toEqual({ record: true, count: 1 });
  });
});
