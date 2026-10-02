import { readdirSync, readFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvValidationError } from '../../src/config/env.js';
import { createLogger } from '../../src/observability/logger.js';
import { disabledVerification, type IdentityVerification } from '../../src/verifier/contract.js';
import { parseVerifierEnv } from '../../src/verifier/env.js';
import { createVerifierServer, secretsMatch } from '../../src/verifier/server.js';
import { VerifierThrottle } from '../../src/verifier/throttle.js';
import { captureLogs } from '../helpers/postgres.js';

const SECRET = 'verifier-test-shared-secret-0123456789abcdef';
const PASSWORD = 'Pw-must-never-be-logged-7731';
const LOGIN = 'someone@example.invalid';

const baseEnv = { NODE_ENV: 'production', VERIFIER_SHARED_SECRET: SECRET } as const;

function problemsOf(action: () => unknown): { problems: readonly string[]; message: string } {
  try {
    action();
  } catch (error) {
    if (error instanceof EnvValidationError) return { problems: error.problems, message: error.message };
    throw error;
  }
  throw new Error('expected an EnvValidationError');
}

const servers: Server[] = [];

async function start(
  overrides: Partial<{
    timeoutMs: number;
    throttleMax: number;
    bodyLimitBytes: number;
    verification: IdentityVerification;
  }> = {},
) {
  const logs = captureLogs();
  const config = parseVerifierEnv({ ...baseEnv });
  const server = createVerifierServer({
    config: {
      ...config,
      timeoutMs: overrides.timeoutMs ?? config.timeoutMs,
      throttleMax: overrides.throttleMax ?? config.throttleMax,
      bodyLimitBytes: overrides.bodyLimitBytes ?? config.bodyLimitBytes,
    },
    logger: createLogger({ level: 'debug', service: 'verifier', destination: logs.stream }),
    verification: overrides.verification,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { logs, url: `http://127.0.0.1:${port}`, port };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

const auth = { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' };
const credentials = JSON.stringify({ login: LOGIN, password: PASSWORD });

describe('verifier endpoint (disabled mode, STACK-2 option C)', () => {
  it('answers the uniform denial for well-formed requests, whatever the credentials', async () => {
    const { url } = await start();
    const first = await fetch(`${url}/internal/verify`, { method: 'POST', headers: auth, body: credentials });
    const second = await fetch(`${url}/internal/verify`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ login: 'other', password: 'x' }),
    });
    expect(first.status).toBe(403);
    expect(second.status).toBe(403);
    const firstBody = await first.text();
    expect(firstBody).toBe('{"ok":false,"code":"denied"}');
    expect(await second.text()).toBe(firstBody);
    expect(first.headers.get('cache-control')).toBe('no-store');
  });

  it('never produces a success verdict, even when the adapter fails or hangs', async () => {
    const rejecting = await start({
      verification: { verify: () => Promise.reject(new Error(`boom ${PASSWORD}`)) },
    });
    const failed = await fetch(`${rejecting.url}/internal/verify`, { method: 'POST', headers: auth, body: credentials });
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('{"ok":false,"code":"unavailable"}');
    expect(JSON.stringify(rejecting.logs.lines())).not.toContain(PASSWORD);

    const hanging = await start({ timeoutMs: 150, verification: { verify: () => new Promise(() => undefined) } });
    const started = Date.now();
    const timedOut = await fetch(`${hanging.url}/internal/verify`, { method: 'POST', headers: auth, body: credentials });
    expect(timedOut.status).toBe(503);
    expect(await timedOut.text()).toBe('{"ok":false,"code":"unavailable"}');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses a wrong, missing or malformed internal secret with a minimal 401 and never consults the verifier', async () => {
    const verify = vi.fn(disabledVerification.verify);
    const { url } = await start({ verification: { verify } });
    const attempts: Record<string, string>[] = [
      { authorization: 'Bearer wrong-secret-wrong-secret-wrong-secret!' },
      { authorization: `Bearer ${SECRET}x` },
      { authorization: SECRET },
      { authorization: `Basic ${SECRET}` },
      {},
    ];
    for (const headers of attempts) {
      const response = await fetch(`${url}/internal/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: credentials,
      });
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('{"ok":false,"code":"unauthorized"}');
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it('refuses an oversized body, declared or streamed, before parsing it', async () => {
    const verify = vi.fn(disabledVerification.verify);
    const { url, port, logs } = await start({ bodyLimitBytes: 256, verification: { verify } });
    const declared = await fetch(`${url}/internal/verify`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ login: LOGIN, password: PASSWORD + 'p'.repeat(600) }),
    });
    expect(declared.status).toBe(413);
    expect(await declared.text()).toBe('{"ok":false,"code":"payload_too_large"}');

    // Chunked upload: no Content-Length, the stream count must enforce the limit.
    const streamedStatus = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(
        { host: '127.0.0.1', port, path: '/internal/verify', method: 'POST', headers: { ...auth, 'transfer-encoding': 'chunked' } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      outgoing.on('error', reject);
      outgoing.write(`{"login":"${LOGIN}","password":"${PASSWORD}`);
      outgoing.write('q'.repeat(600));
      outgoing.end('"}');
    });
    expect(streamedStatus).toBe(413);
    expect(verify).not.toHaveBeenCalled();
    expect(JSON.stringify(logs.lines())).not.toContain(PASSWORD);
  });

  it('rejects malformed bodies without echoing them', async () => {
    const { url, logs } = await start();
    const bodies = [
      `{"login":"${LOGIN}","password":"${PASSWORD}"`, // truncated JSON
      JSON.stringify({ login: LOGIN, password: PASSWORD, extra: 'x' }), // unknown key (strict)
      JSON.stringify({ login: LOGIN }), // missing password
      JSON.stringify({ login: LOGIN, password: 42 }),
      `[${credentials}]`,
    ];
    for (const body of bodies) {
      const response = await fetch(`${url}/internal/verify`, { method: 'POST', headers: auth, body });
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe('{"ok":false,"code":"bad_request"}');
    }
    expect(JSON.stringify(logs.lines())).not.toContain(PASSWORD);
  });

  it('never writes the password, the login or the shared secret to the logs', async () => {
    const { url, logs } = await start();
    await fetch(`${url}/internal/verify?login=${LOGIN}&password=${PASSWORD}`, { method: 'POST', headers: auth, body: credentials });
    await fetch(`${url}/internal/verify`, { method: 'POST', headers: { authorization: 'Bearer nope' }, body: credentials });
    await fetch(`${url}/internal/verify`, { method: 'POST', headers: auth, body: 'not json ' + PASSWORD });
    await fetch(`${url}/health`);
    const lines = logs.lines();
    expect(lines.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(LOGIN);
    expect(serialized).not.toContain(SECRET);
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(
        ['level', 'time', 'service', 'msg', 'requestId', 'method', 'path', 'status', 'outcome', 'ms'].sort(),
      );
    }
  });

  it('throttles callers after the configured budget (fail closed, minimal 429)', async () => {
    const { url } = await start({ throttleMax: 2 });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${url}/internal/verify`, { method: 'POST', headers: auth, body: credentials });
      statuses.push(response.status);
      if (response.status === 429) expect(await response.text()).toBe('{"ok":false,"code":"rate_limited"}');
      else await response.text();
    }
    expect(statuses).toEqual([403, 403, 429, 429]);
  });

  it('exposes only /health (no auth, no detail) and answers 404 elsewhere', async () => {
    const { url } = await start();
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('{"status":"ok"}');
    for (const [method, path] of [['GET', '/internal/verify'], ['POST', '/health'], ['GET', '/'], ['POST', '/internal/other']] as const) {
      const response = await fetch(`${url}${path}`, { method, headers: auth, body: method === 'POST' ? credentials : undefined });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(await response.text()).toBe('{"ok":false,"code":"not_found"}');
    }
  });
});

describe('shared secret comparison', () => {
  it('matches only identical secrets, of any length', () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
    expect(secretsMatch(SECRET + 'x', SECRET)).toBe(false);
    expect(secretsMatch('', SECRET)).toBe(false);
    expect(secretsMatch('x'.repeat(10_000), SECRET)).toBe(false);
  });
});

describe('verifier throttle', () => {
  it('limits per window, resets after it, and caps concurrency', () => {
    let now = 1000;
    const throttle = new VerifierThrottle(3, 1000, 2, () => now);
    const first = throttle.tryAcquire();
    const second = throttle.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(throttle.tryAcquire()).toBeNull(); // concurrency cap (2)
    first?.();
    first?.(); // idempotent
    const third = throttle.tryAcquire();
    expect(third).not.toBeNull();
    second?.();
    third?.();
    expect(throttle.tryAcquire()).toBeNull(); // window budget (3) spent
    now += 1000;
    expect(throttle.tryAcquire()).not.toBeNull();
  });
});

describe('verifier environment (fail closed on boot)', () => {
  it('defaults to disabled, loopback and safe limits, and holds the secret as a Secret', () => {
    const config = parseVerifierEnv({ ...baseEnv });
    expect(config.mode).toBe('disabled');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3002);
    expect(config.timeoutMs).toBe(5000);
    expect(String(config.sharedSecret)).toBe('[redacted]');
    expect(JSON.stringify(config)).not.toContain(SECRET);
  });

  it('refuses live mode as not implemented, and unknown modes', () => {
    const live = problemsOf(() => parseVerifierEnv({ ...baseEnv, VERIFIER_MODE: 'live' }));
    expect(live.problems.join('\n')).toMatch(/VERIFIER_MODE: "live" is not implemented/);
    for (const mode of ['fake', 'enabled', 'Live', 'true', 'dev']) {
      const unknown = problemsOf(() => parseVerifierEnv({ ...baseEnv, VERIFIER_MODE: mode }));
      expect(unknown.problems.join('\n'), mode).toMatch(/VERIFIER_MODE: must be one of/);
      expect(unknown.message).not.toContain(SECRET);
    }
  });

  it('requires NODE_ENV and a long shared secret, and never echoes secret values', () => {
    expect(problemsOf(() => parseVerifierEnv({ VERIFIER_SHARED_SECRET: SECRET })).problems.join('\n')).toMatch(/NODE_ENV/);
    expect(problemsOf(() => parseVerifierEnv({ NODE_ENV: 'production' })).problems.join('\n')).toMatch(/VERIFIER_SHARED_SECRET/);
    const short = problemsOf(() => parseVerifierEnv({ NODE_ENV: 'production', VERIFIER_SHARED_SECRET: 'short-secret-value' }));
    expect(short.problems.join('\n')).toMatch(/at least 32/);
    expect(short.message).not.toContain('short-secret-value');
  });

  it('reads the secret from a file (trailing newline stripped), and refuses both sources or an unreadable file', () => {
    const fromFile = parseVerifierEnv(
      { NODE_ENV: 'production', VERIFIER_SHARED_SECRET_FILE: '/run/secrets/verifier' },
      (path) => {
        expect(path).toBe('/run/secrets/verifier');
        return `${SECRET}\n`;
      },
    );
    expect(fromFile.sharedSecret.reveal()).toBe(SECRET);
    expect(
      problemsOf(() => parseVerifierEnv({ ...baseEnv, VERIFIER_SHARED_SECRET_FILE: '/x' }, () => SECRET)).problems.join('\n'),
    ).toMatch(/set exactly one/);
    expect(
      problemsOf(() =>
        parseVerifierEnv({ NODE_ENV: 'production', VERIFIER_SHARED_SECRET_FILE: '/missing' }, () => {
          throw new Error('ENOENT /missing');
        }),
      ).problems.join('\n'),
    ).toMatch(/cannot be read/);
  });

  it('refuses Sankhya, database, session and similar settings in the verifier process', () => {
    for (const key of ['SANKHYA_CLIENT_SECRET', 'SANKHYA_MODE', 'DATABASE_URL', 'DB_POOL_MAX', 'PGPASSWORD', 'SESSION_SECRET']) {
      const refused = problemsOf(() => parseVerifierEnv({ ...baseEnv, [key]: 'value-that-must-not-leak-9911' }));
      expect(refused.problems.join('\n'), key).toContain(key);
      expect(refused.message).not.toContain('value-that-must-not-leak-9911');
    }
    // An empty variable is the same as an unset one.
    expect(() => parseVerifierEnv({ ...baseEnv, SANKHYA_CLIENT_SECRET: '' })).not.toThrow();
  });
});

describe('verifier boundaries (STACK-2, STACK-3)', () => {
  const dir = fileURLToPath(new URL('../../src/verifier', import.meta.url));
  const files = [
    ...readdirSync(dir).map((name) => join(dir, name)),
    fileURLToPath(new URL('../../src/main-verifier.ts', import.meta.url)),
  ];

  it('imports no database, queue, gateway or Nest code and never uses console', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/from '@salesforce\/db'|from 'pg'|from 'pg-boss'|from '@nestjs|createGateway|SankhyaGateway/);
      expect(text, file).not.toMatch(/\bconsole\./);
    }
  });

  it('does not read the request body into any logger call', () => {
    const text = readFileSync(join(dir, 'server.ts'), 'utf8');
    expect(text).not.toMatch(/logger\.\w+\([^)]*(raw|input|parsed|password|body)\b/);
  });
});
