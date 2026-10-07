import { describe, expect, it } from 'vitest';
import { externalLoginProblems, externalVerifierOf } from '../../src/config/external-login-env.js';

const secret = 'api-verifier-shared-secret-0123456789abcdef';
const on = { EXTERNAL_LOGIN_ENABLED: '1' as const, VERIFIER_URL: 'http://verifier:3002' };

describe('API external login settings (AUTH-5)', () => {
  it('is off by default and reads no verifier setting', () => {
    expect(externalLoginProblems({ EXTERNAL_LOGIN_ENABLED: '0' })).toEqual([]);
    expect(externalVerifierOf({ ...on, EXTERNAL_LOGIN_ENABLED: '0', VERIFIER_SHARED_SECRET: secret })).toBeNull();
  });

  it('when on, requires the verifier URL and exactly one secret source', () => {
    expect(externalLoginProblems({ EXTERNAL_LOGIN_ENABLED: '1' }).join(' ')).toMatch(/VERIFIER_URL: is required/);
    expect(externalLoginProblems({ ...on, VERIFIER_URL: 'ftp://x', VERIFIER_SHARED_SECRET: secret }).join(' ')).toMatch(/http\(s\)/);
    expect(externalLoginProblems({ ...on }).join(' ')).toMatch(/exactly one/);
    expect(
      externalLoginProblems({ ...on, VERIFIER_SHARED_SECRET: secret, VERIFIER_SHARED_SECRET_FILE: '/run/s' }).join(' '),
    ).toMatch(/exactly one/);
    expect(externalLoginProblems({ ...on, VERIFIER_SHARED_SECRET: secret })).toEqual([]);
  });

  it('automatic provisioning is an explicit opt-in that needs the external login', () => {
    expect(externalLoginProblems({ EXTERNAL_LOGIN_ENABLED: '0', EXTERNAL_AUTO_PROVISION: '1' })).toEqual([
      'EXTERNAL_AUTO_PROVISION: needs EXTERNAL_LOGIN_ENABLED=1.',
    ]);
    expect(externalLoginProblems({ ...on, VERIFIER_SHARED_SECRET: secret, EXTERNAL_AUTO_PROVISION: '1' }).join(' ')).toMatch(/IDUSU_IS_CODUSU_VALIDATED/);
    expect(externalLoginProblems({ ...on, VERIFIER_SHARED_SECRET: secret, EXTERNAL_AUTO_PROVISION: '1', EXTERNAL_IDUSU_IS_CODUSU_VALIDATED: '1' })).toEqual([]);
    expect(externalLoginProblems({ EXTERNAL_LOGIN_ENABLED: '0' })).toEqual([]);
  });

  it('refuses a short secret without echoing it, and reads a secret file', () => {
    expect(() => externalVerifierOf({ ...on, VERIFIER_SHARED_SECRET: 'short' })).toThrow(/at least 32/);
    try {
      externalVerifierOf({ ...on, VERIFIER_SHARED_SECRET: 'short-secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('short-secret-value');
    }
    expect(externalVerifierOf({ ...on, VERIFIER_SHARED_SECRET_FILE: '/run/s' }, () => `${secret}\n`)).toEqual({
      url: 'http://verifier:3002',
      sharedSecret: secret,
    });
    expect(() =>
      externalVerifierOf({ ...on, VERIFIER_SHARED_SECRET_FILE: '/missing' }, () => {
        throw new Error('ENOENT /missing');
      }),
    ).toThrow(/cannot be read/);
  });
});
