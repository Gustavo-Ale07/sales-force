import { describe, expect, it } from 'vitest';
import {
  BootstrapFileConfigurationSource,
  DEMO_CONFIGURATION,
  NotImplementedError,
  SankhyaGatewayError,
  UnavailableConfigurationSource,
  type ConfigurationValidator,
} from '../src/index.js';

const NOW = Date.parse('2026-09-18T10:00:00.000Z');
const accept: ConfigurationValidator = (raw) => ({ ok: true, value: raw as never });

function source(text: string, validate: ConfigurationValidator = accept) {
  return new BootstrapFileConfigurationSource({ path: 'cfg.json', validate, now: () => NOW, readText: () => Promise.resolve(text) });
}

async function failureOf(promise: Promise<unknown>): Promise<SankhyaGatewayError> {
  return (await promise.then(
    () => null,
    (error: unknown) => error,
  )) as SankhyaGatewayError;
}

describe('BootstrapFileConfigurationSource', () => {
  it('stamps the source as bootstrap-file with the injected time and a content-hash version', async () => {
    const configuration = await source('{"schemaVersion":1,"general":{"enabled":true}}').read();
    expect(configuration.source.kind).toBe('bootstrap-file');
    expect(configuration.source.syncedAt).toBe('2026-09-18T10:00:00.000Z');
    expect(configuration.source.version).toMatch(/^sha256:[0-9a-f]{12}$/);
  });

  it('keeps the file version when it declares one', async () => {
    const configuration = await source('{"source":{"kind":"bootstrap-file","version":"2026-09-a"}}').read();
    expect(configuration.source.version).toBe('2026-09-a');
  });

  it('a file cannot claim to come from Sankhya or the demo', async () => {
    for (const kind of ['sankhya', 'demo']) {
      const failure = await failureOf(source(`{"source":{"kind":"${kind}"}}`).read());
      expect(failure.code).toBe('config_file_source_kind');
      expect(failure.retryable).toBe(false);
    }
  });

  it('rejects invalid JSON without echoing content', async () => {
    const failure = await failureOf(source('{"secret": not-json').read());
    expect(failure).toMatchObject({ kind: 'validation', code: 'config_file_invalid_json' });
    expect(failure.message).not.toContain('secret');
  });

  it('rejects non-objects and oversized files', async () => {
    expect((await failureOf(source('[1]').read())).code).toBe('config_file_invalid');
    expect((await failureOf(source(`"${'x'.repeat(1_000_001)}"`).read())).code).toMatch(/config_file_too_large|config_file_invalid/);
    expect((await failureOf(source(' '.repeat(1_000_001)).read())).code).toBe('config_file_too_large');
  });

  it('reports validator issues (bounded) as a validation error', async () => {
    const validate: ConfigurationValidator = () => ({ ok: false, issues: Array.from({ length: 30 }, (_, i) => `issue ${i}`) });
    const failure = await failureOf(source('{}', validate).read());
    expect(failure).toMatchObject({ kind: 'validation', code: 'config_file_invalid' });
    expect(failure.message).toContain('issue 0');
    expect(failure.message).not.toContain('issue 29');
  });

  it('an unreadable file is a permanent error', async () => {
    const unreadable = new BootstrapFileConfigurationSource({ path: 'missing.json', validate: accept, readText: () => Promise.reject(new Error('ENOENT secret/path')) });
    const failure = await failureOf(unreadable.read());
    expect(failure).toMatchObject({ kind: 'permanent', code: 'config_file_unreadable' });
    expect(failure.message).not.toContain('secret/path');
  });

  it('requires a path', () => {
    expect(() => new BootstrapFileConfigurationSource({ path: ' ', validate: accept })).toThrow(TypeError);
  });

  it('honours an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(source('{}').read({ signal: controller.signal })).rejects.toThrow();
  });
});

describe('UnavailableConfigurationSource', () => {
  it('is NEEDS VALIDATION U-10 / U-11', async () => {
    const failure = await failureOf(new UnavailableConfigurationSource().read());
    expect(failure).toBeInstanceOf(NotImplementedError);
    expect(failure.message).toContain('NEEDS VALIDATION U-10');
  });
});

it('the demo configuration is not a file-loadable source', () => {
  expect(DEMO_CONFIGURATION.source.kind).toBe('demo');
});
