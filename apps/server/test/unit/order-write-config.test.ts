import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '../../src/config/api-env.js';
import { EnvValidationError } from '../../src/config/env.js';
import { loadWorkerConfig } from '../../src/config/worker-env.js';

const DATABASE_URL = 'postgres://user:not-a-real-password@127.0.0.1:5432/db';
const WORKER = { DATABASE_URL, NODE_ENV: 'development' } as const;

function problemsOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected an EnvValidationError');
}

describe('ERP order submission switches (SNK-7 D-1)', () => {
  it('the worker has submission off by default', () => {
    expect(loadWorkerConfig({ ...WORKER }).orderWrite).toEqual({ enabled: false, mode: 'off', originField: null });
  });

  it('dry_run needs nothing else and works with the fake gateway', () => {
    const config = loadWorkerConfig({ ...WORKER, SANKHYA_ORDER_WRITE_ENABLED: 'true' });
    expect(config.orderWrite.mode).toBe('dry_run');
  });

  it('live mode is refused at boot without the closed-gates marker and the origin field', () => {
    const problems = problemsOf(() =>
      loadWorkerConfig({ ...WORKER, SANKHYA_ORDER_WRITE_ENABLED: 'true', SANKHYA_ORDER_WRITE_MODE: 'live' }),
    );
    expect(problems.join('\n')).toContain('GATES_CLOSED=1');
    expect(problems.join('\n')).toContain('SANKHYA_ORDER_ORIGIN_FIELD');
  });

  it('live mode is refused when NODE_ENV=production even with every other prerequisite', () => {
    const problems = problemsOf(() =>
      loadWorkerConfig({
        DATABASE_URL,
        NODE_ENV: 'production',
        SANKHYA_MODE: 'fake',
        ALLOW_FAKE_GATEWAY: '1',
        SANKHYA_ORDER_WRITE_ENABLED: 'true',
        SANKHYA_ORDER_WRITE_MODE: 'live',
        SANKHYA_ORDER_WRITE_GATES_CLOSED: '1',
        SANKHYA_ORDER_ORIGIN_FIELD: 'AD_SFORIGEM',
      }),
    );
    expect(problems.join('\n')).toMatch(/NODE_ENV=production|SANKHYA_MODE=live/);
  });

  it('the API never reads the order switches', () => {
    const api = parseApiEnv({
      DATABASE_URL,
      NODE_ENV: 'development',
      ALLOW_DEV_AUTH: '1',
      SANKHYA_ORDER_WRITE_ENABLED: 'true',
    }) as unknown as Record<string, unknown>;
    expect(JSON.stringify(api)).not.toContain('ORDER_WRITE');
    expect('orderWrite' in api).toBe(false);
  });

  it('no shipped deploy file enables submission', () => {
    const dir = join(__dirname, '..', '..', '..', '..', 'deploy');
    const files: string[] = [];
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ya?ml|sh|sql)$|compose|worker/.test(entry.name)) files.push(full);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (line.trim().startsWith('#') || line.trim().startsWith('--')) continue;
        if (!line.includes('SANKHYA_ORDER_WRITE_ENABLED')) continue;
        expect(line, file).toMatch(/SANKHYA_ORDER_WRITE_ENABLED:\s*"false"/);
      }
      expect(text, file).not.toMatch(/SANKHYA_ORDER_WRITE_MODE:\s*"?live/);
    }
  });
});
