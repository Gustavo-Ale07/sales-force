import { describe, expect, it } from 'vitest';
import { GatewayConfigError } from '../src/errors.js';
import { SANDBOX_WRITE_HOSTS, assertSandboxHost, writeHostRefusal } from '../src/write/host-allowlist.js';

describe('Sandbox write host allow-list (SNK-7 S2)', () => {
  it('is exactly the two Sandbox hosts', () => {
    expect([...SANDBOX_WRITE_HOSTS].sort()).toEqual(['api.sandbox.sankhya.com.br', 'placfestas-teste.sankhyacloud.com.br']);
  });

  it.each([
    'https://api.sandbox.sankhya.com.br',
    'https://api.sandbox.sankhya.com.br/gateway/v1/mgecom/service.sbr?serviceName=CACSP.incluirNota&outputType=json',
    'https://placfestas-teste.sankhyacloud.com.br/gateway/v1/mge/service.sbr',
    'https://API.SANDBOX.SANKHYA.COM.BR/x',
  ])('accepts %s', (url) => {
    expect(writeHostRefusal(url)).toBeNull();
    expect(() => assertSandboxHost(url)).not.toThrow();
  });

  it.each([
    ['http://api.sandbox.sankhya.com.br', 'not_https'],
    ['https://user:pw@api.sandbox.sankhya.com.br', 'credentials_in_url'],
    ['https://api.sandbox.sankhya.com.br:8443', 'port_not_allowed'],
    ['https://api.sandbox.sankhya.com.br.', 'host_not_allowed'],
    ['https://api.sandbox.sankhya.com.br.evil.test', 'host_not_allowed'],
    ['https://evil.test/api.sandbox.sankhya.com.br', 'host_not_allowed'],
    ['https://xapi.sandbox.sankhya.com.br', 'host_not_allowed'],
    ['https://sub.api.sandbox.sankhya.com.br', 'host_not_allowed'],
    ['https://placfestas.sankhyacloud.com.br', 'host_not_allowed'],
    ['https://sankhyacloud.com.br', 'host_not_allowed'],
    ['https://127.0.0.1', 'host_not_allowed'],
    ['https://localhost', 'host_not_allowed'],
    ['https://[::1]', 'host_not_allowed'],
    ['not a url', 'invalid_url'],
    ['', 'invalid_url'],
  ])('refuses %s', (url, reason) => {
    expect(writeHostRefusal(url)).toBe(reason);
    expect(() => assertSandboxHost(url)).toThrow(GatewayConfigError);
  });

  it('never echoes the URL in the error', () => {
    try {
      assertSandboxHost('https://secret-host.example.test/?token=abc');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-host');
      expect(String((error as Error).message)).not.toContain('abc');
      return;
    }
    throw new Error('expected a refusal');
  });
});
