import { ConfigurationResponseSchema } from '@salesforce/contracts';
import { defaultUnconfiguredConfiguration } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import { buildConfigurationResponse, toConfigurationSummary } from '../../src/configuration/configuration-summary.js';
import { AppError } from '../../src/http/app-error.js';
import { assertAuditDetailSafe, ForbiddenAuditDetailError } from '../../src/iam/audit.service.js';
import { buildRedactPaths, caseVariants } from '../../src/observability/logger.js';

describe('audit detail guard', () => {
  it('allows facts and identifiers', () => {
    expect(() =>
      assertAuditDetailSafe({ reason: 'bad_password', ipHash: 'abc123', attempts: 3, locked: true, until: null }),
    ).not.toThrow();
    expect(() => assertAuditDetailSafe(undefined)).not.toThrow();
  });

  it('refuses any key that looks like a credential, in any spelling', () => {
    for (const key of ['password', 'newPassword', 'passwd', 'sessionToken', 'token', 'client_secret', 'Cookie', 'authorization', 'credentials']) {
      expect(() => assertAuditDetailSafe({ [key]: 'x' }), key).toThrow(ForbiddenAuditDetailError);
    }
  });
});

describe('redaction key variants', () => {
  it('covers kebab, snake, camel, Pascal, header-case and upper spellings', () => {
    const variants = caseVariants('proxy-authorization');
    for (const spelling of [
      'proxy-authorization',
      'proxy_authorization',
      'proxyauthorization',
      'proxyAuthorization',
      'ProxyAuthorization',
      'Proxy-Authorization',
      'PROXY-AUTHORIZATION',
    ]) {
      expect(variants, spelling).toContain(spelling);
    }
  });

  it('produces unique paths at several depths and never a bare wildcard', () => {
    const paths = buildRedactPaths(['password']);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('password');
    expect(paths.some((path) => path.includes('*.password') || path.includes('*.*.password'))).toBe(true);
    expect(paths).not.toContain('*');
  });
});

describe('AppError retry-after', () => {
  it('mirrors retryAfterSeconds into the details of a rate_limited error', () => {
    const error = new AppError('rate_limited', { retryAfterSeconds: 42 });
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(42);
    expect(error.details).toEqual({ retryAfterSeconds: 42 });
  });

  it('leaves details untouched when there is no retry-after', () => {
    expect(new AppError('forbidden').details).toBeUndefined();
  });
});

describe('configuration summary', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');

  it('builds a contract-valid body for the unconfigured installation, with no content hash', () => {
    const configuration = defaultUnconfiguredConfiguration();
    const body = buildConfigurationResponse({ state: 'not_configured', configuration, contentHash: null }, [], now);
    expect(body.contentHash).toBeNull();
    expect(body.syncStates).toEqual([]);
    expect(ConfigurationResponseSchema.safeParse(body).success).toBe(true);
  });

  it('reduces account e-mail links to a count', () => {
    const base = defaultUnconfiguredConfiguration();
    const configuration = {
      ...base,
      customers: {
        ...base.customers,
        accountSellerLinks: [{ accountEmail: 'someone@example.test', sellerCode: 7 }],
      },
    };
    const summary = toConfigurationSummary(configuration);
    expect(summary.customers.accountSellerLinkCount).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('someone@example.test');
  });
});
