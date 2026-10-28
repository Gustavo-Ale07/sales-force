import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '../../src/config/api-env.js';
import { localPasswordRefusal } from '../../src/config/auth-mode-guard.js';
import { EnvValidationError } from '../../src/config/env.js';
import { parseSeedEnv } from '../../src/config/seed-env.js';
import { authConfigFromEnv, assertSafeAuthConfig, LOCAL_MODE_ROLES, withExternalSellerLogin, type AuthConfig } from '../../src/iam/auth-config.js';
import { testAuthConfig } from '../helpers/auth.js';

/** PB-1 · AUTH_MODE=external: verifier mandatory for operational users, local Argon2id for admin/technical only. */
const DATABASE_URL = 'postgres://user:hunter2-not-a-real-password@127.0.0.1:5432/db';
const PROD = { DATABASE_URL, NODE_ENV: 'production', TRUST_PROXY: '1', ALLOWED_ORIGINS: 'https://app.example.com', SF_ERP_ENVIRONMENT: 'production', SF_DATASET_ID: 'plac-prod-1' } as const;
const SECRET = 'a-synthetic-shared-secret-of-32-chars-minimum!';
const VERIFIER = { EXTERNAL_LOGIN_ENABLED: '1', VERIFIER_URL: 'http://verifier:3002', VERIFIER_SHARED_SECRET: SECRET } as const;
const EXTERNAL = { ...PROD, AUTH_MODE: 'external', ...VERIFIER } as const;

function problemsOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected an EnvValidationError');
}

describe('AUTH_MODE=external: startup validation', () => {
  it('boots in production with the verifier configured and no dev switch', () => {
    const env = parseApiEnv({ ...EXTERNAL });
    expect(env.AUTH_MODE).toBe('external');
    expect(env.externalVerifier).not.toBeNull();
  });

  it('refuses the mode when the directory login is off or unset, naming only the variable', () => {
    for (const extra of [{ EXTERNAL_LOGIN_ENABLED: '0' }, { EXTERNAL_LOGIN_ENABLED: undefined }]) {
      const problems = problemsOf(() => parseApiEnv({ ...EXTERNAL, ...extra }));
      expect(problems).toEqual([expect.stringMatching(/^EXTERNAL_LOGIN_ENABLED: .*AUTH_MODE=external/)]);
    }
  });

  it('refuses a missing or malformed verifier configuration without echoing any value', () => {
    for (const extra of [{ VERIFIER_URL: undefined }, { VERIFIER_URL: 'ftp://x:y@verifier/' }, { VERIFIER_SHARED_SECRET: undefined }]) {
      const problems = problemsOf(() => parseApiEnv({ ...EXTERNAL, ...extra }));
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join(' ')).not.toContain(SECRET);
      expect(problems.join(' ')).not.toContain('ftp://');
    }
    const short = problemsOf(() => parseApiEnv({ ...EXTERNAL, VERIFIER_SHARED_SECRET: 'too-short' }));
    expect(short.join(' ')).toMatch(/VERIFIER_SHARED_SECRET/);
    expect(short.join(' ')).not.toContain('too-short');
  });

  it('refuses auto-provision without the idusu/CODUSU proof, and accepts it with the proof', () => {
    const problems = problemsOf(() => parseApiEnv({ ...EXTERNAL, EXTERNAL_AUTO_PROVISION: '1' }));
    expect(problems).toEqual([expect.stringMatching(/^EXTERNAL_AUTO_PROVISION: needs EXTERNAL_IDUSU_IS_CODUSU_VALIDATED=1/)]);
    expect(parseApiEnv({ ...EXTERNAL, EXTERNAL_AUTO_PROVISION: '1', EXTERNAL_IDUSU_IS_CODUSU_VALIDATED: '1' }).EXTERNAL_AUTO_PROVISION).toBe('1');
  });

  it('refuses every demo / dev bypass switch', () => {
    for (const value of ['1', '0', 'true']) {
      expect(problemsOf(() => parseApiEnv({ ...EXTERNAL, ALLOW_DEV_AUTH: value }))).toEqual([
        expect.stringMatching(/^ALLOW_DEV_AUTH: must not be set when AUTH_MODE=external/),
      ]);
    }
    expect(problemsOf(() => parseApiEnv({ ...EXTERNAL, SF_ALLOW_DEMO_ACCOUNTS: 'true' }))).toEqual([
      expect.stringMatching(/^SF_ALLOW_DEMO_ACCOUNTS: must not be set when AUTH_MODE=external/),
    ]);
  });

  it('keeps every other production guard (dev mode still refused; unknown values still refused)', () => {
    expect(problemsOf(() => parseApiEnv({ ...EXTERNAL, AUTH_MODE: 'dev' })).some((p) => p.startsWith('AUTH_MODE: the dev mode'))).toBe(true);
    expect(problemsOf(() => parseApiEnv({ ...EXTERNAL, AUTH_MODE: 'standard' })).some((p) => p.startsWith('AUTH_MODE:'))).toBe(true);
    expect(problemsOf(() => parseApiEnv({ ...EXTERNAL, ALLOWED_ORIGINS: undefined }))).toEqual([expect.stringMatching(/^ALLOWED_ORIGINS/)]);
  });

  it('is unchanged for the old modes: local stays valid without a verifier, dev stays dev-only', () => {
    expect(parseApiEnv({ ...PROD, AUTH_MODE: 'local' }).AUTH_MODE).toBe('local');
    expect(parseApiEnv({ DATABASE_URL, NODE_ENV: 'development', ALLOW_DEV_AUTH: '1' }).AUTH_MODE).toBe('dev');
  });
});

describe('AUTH_MODE=external: resulting login policy', () => {
  const config = () => authConfigFromEnv(parseApiEnv({ ...EXTERNAL }));

  it('reports the mode, enables the directory login, and admits admin/technical locally plus seller/manager only through the directory', () => {
    const auth = config();
    expect(auth.authMode).toBe('external');
    expect(auth.externalLogin?.enabled).toBe(true);
    expect(auth.externalLogin?.linkMode).toBe('PRE_LINKED');
    expect(auth.allowedRoles).toEqual([...LOCAL_MODE_ROLES, 'seller']);
    expect(auth.externalOnlyRoles).toEqual(['manager']);
  });

  it('uses VERIFIED_AUTO_PROVISION only when the flag and its proof are both set', () => {
    const auto = authConfigFromEnv(parseApiEnv({ ...EXTERNAL, EXTERNAL_AUTO_PROVISION: '1', EXTERNAL_IDUSU_IS_CODUSU_VALIDATED: '1' }));
    expect(auto.externalLogin?.linkMode).toBe('VERIFIED_AUTO_PROVISION');
  });

  it('assertSafeAuthConfig accepts the env-built config', () => {
    expect(() => assertSafeAuthConfig(config())).not.toThrow();
  });

  it('assertSafeAuthConfig refuses an external config without the directory login, without role limits, or with a local operational role', () => {
    const good = config();
    const noLogin: AuthConfig = { ...testAuthConfig({ authMode: 'external', allowedRoles: LOCAL_MODE_ROLES }) };
    expect(() => assertSafeAuthConfig(noLogin)).toThrow(/external/);
    const { externalLogin: _drop, ...withoutLogin } = good;
    expect(() => assertSafeAuthConfig(withoutLogin as AuthConfig)).toThrow(/external/);
    const { allowedRoles: _roles, ...withoutRoles } = good;
    expect(() => assertSafeAuthConfig(withoutRoles as AuthConfig)).toThrow(/external/);
    expect(() => assertSafeAuthConfig({ ...good, allowedRoles: ['admin', 'technical', 'seller', 'manager'] })).toThrow(/external/);
    const { externalOnlyRoles: _only, ...withoutOnly } = good;
    expect(() => assertSafeAuthConfig({ ...withoutOnly, allowedRoles: ['admin', 'technical', 'seller'] })).not.toThrow();
  });

  it('assertSafeAuthConfig leaves the old modes alone', () => {
    expect(() => assertSafeAuthConfig(testAuthConfig({ authMode: 'dev' }))).not.toThrow();
    expect(() => assertSafeAuthConfig(testAuthConfig({ authMode: 'local', allowedRoles: LOCAL_MODE_ROLES }))).not.toThrow();
    const hybrid = withExternalSellerLogin(testAuthConfig({ authMode: 'local', allowedRoles: LOCAL_MODE_ROLES }), { enabled: true, verifyTimeoutMs: 1, minFailureMs: 0 });
    expect(() => assertSafeAuthConfig(hybrid)).not.toThrow();
  });
});

describe('AUTH_MODE=external: no dormant local operational accounts', () => {
  it('the operator CLI refuses a local seller or manager in external mode with an actionable message, but not admin/technical', () => {
    for (const role of ['seller', 'manager']) {
      expect(localPasswordRefusal('external', role)).toMatch(/create-external/);
    }
    expect(localPasswordRefusal('external', 'admin')).toBeNull();
    expect(localPasswordRefusal('external', 'technical')).toBeNull();
  });

  it('the CLI keeps working for the old modes and when AUTH_MODE is unset', () => {
    for (const mode of [undefined, 'dev', 'local']) {
      expect(localPasswordRefusal(mode, 'seller')).toBeNull();
    }
  });

  it('the dev seed refuses to run under AUTH_MODE=external (it creates demo sellers with a local password)', () => {
    const base = { NODE_ENV: 'development', DATABASE_URL, SEED_DEV_PASSWORD: 'Correct-Horse-Battery-9!' };
    expect(parseSeedEnv(base).NODE_ENV).toBe('development');
    expect(parseSeedEnv({ ...base, AUTH_MODE: 'dev' }).NODE_ENV).toBe('development');
    expect(() => parseSeedEnv({ ...base, AUTH_MODE: 'external' })).toThrow(/AUTH_MODE/);
  });
});
