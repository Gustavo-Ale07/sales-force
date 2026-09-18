import { defaultUnconfiguredConfiguration } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import {
  ConfigurationResponseSchema,
  ConfigurationSummarySchema,
  InstallationConfigurationSchema,
} from '../src/index.js';
import { makeConfig } from './fixtures.js';

function issuesOf(input: unknown) {
  const result = InstallationConfigurationSchema.safeParse(input);
  return result.success ? [] : result.error.issues;
}

describe('InstallationConfigurationSchema', () => {
  it('round-trips the conservative unconfigured configuration unchanged', () => {
    const input = defaultUnconfiguredConfiguration();
    const parsed = InstallationConfigurationSchema.parse(input);
    expect(parsed).toEqual(input);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(input);
  });

  it('round-trips a populated configuration', () => {
    const config = makeConfig();
    expect(InstallationConfigurationSchema.parse(config)).toEqual(config);
  });

  it('rejects unknown top-level keys', () => {
    const issues = issuesOf({ ...makeConfig(), extra: true });
    expect(issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('rejects unknown nested keys', () => {
    const config = makeConfig();
    const tampered = { ...config, general: { ...config.general, surprise: 1 } };
    expect(issuesOf(tampered).length).toBeGreaterThan(0);
  });

  it('accepts arbitrary boolean flags in features, rejects non-boolean values', () => {
    const config = makeConfig((c) => ({
      ...c,
      features: { demoMetrics: true, futureFlag: false },
    }));
    expect(InstallationConfigurationSchema.parse(config).features).toEqual({
      demoMetrics: true,
      futureFlag: false,
    });
    expect(issuesOf({ ...makeConfig(), features: { demoMetrics: 'yes' } }).length).toBeGreaterThan(
      0,
    );
  });

  it('rejects a wrong schema version and malformed values', () => {
    expect(issuesOf({ ...makeConfig(), schemaVersion: 2 }).length).toBeGreaterThan(0);
    const config = makeConfig();
    expect(
      issuesOf({ ...config, source: { ...config.source, syncedAt: 'yesterday' } }).length,
    ).toBeGreaterThan(0);
    expect(
      issuesOf({ ...config, general: { ...config.general, enabledCompanyCodes: [1.5] } }).length,
    ).toBeGreaterThan(0);
  });

  describe('consistency (validateConfigurationConsistency from the domain)', () => {
    it('fixed_table without a table code', () => {
      const config = makeConfig((c) => ({
        ...c,
        pricing: { ...c.pricing, fallbackStrategy: 'fixed_table', fallbackTableCode: null },
      }));
      const issues = issuesOf(config);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toBe('fallback_table_required');
      expect(issues[0]?.path).toEqual(['pricing', 'fallbackTableCode']);
    });

    it('none strategy with a table code', () => {
      const config = makeConfig((c) => ({
        ...c,
        pricing: { ...c.pricing, fallbackStrategy: 'none', fallbackTableCode: 9 },
      }));
      expect(issuesOf(config).map((i) => i.message)).toEqual(['fallback_table_unexpected']);
    });

    it('default negotiation type not in the list, and duplicate types', () => {
      const unknown = makeConfig((c) => ({
        ...c,
        sales: { ...c.sales, defaultNegotiationTypeCode: 99 },
      }));
      expect(issuesOf(unknown).map((i) => i.message)).toEqual(['default_negotiation_type_unknown']);

      const duplicate = makeConfig((c) => ({
        ...c,
        sales: {
          ...c.sales,
          negotiationTypes: [
            { code: 31, label: 'A' },
            { code: 31, label: 'B' },
          ],
        },
      }));
      expect(issuesOf(duplicate).map((i) => i.message)).toContain('duplicate_negotiation_type');
    });

    it('duplicate account/seller links (e-mail compared case-insensitively)', () => {
      const config = makeConfig((c) => ({
        ...c,
        customers: {
          ...c.customers,
          accountSellerLinks: [
            { accountEmail: 'Vendedor@Example.test', sellerCode: 900 },
            { accountEmail: 'vendedor@example.test', sellerCode: 900 },
          ],
        },
      }));
      expect(issuesOf(config).map((i) => i.message)).toEqual(['duplicate_account_seller_link']);
    });
  });
});

describe('client-safe configuration summary', () => {
  const { accountSellerLinks, ...customersWithoutLinks } = makeConfig().customers;
  const summary = {
    ...makeConfig(),
    customers: { ...customersWithoutLinks, accountSellerLinkCount: accountSellerLinks.length },
  };

  it('replaces the e-mail links with a count', () => {
    const parsed = ConfigurationSummarySchema.parse(summary);
    expect(parsed.customers.accountSellerLinkCount).toBe(1);
    expect('accountSellerLinks' in parsed.customers).toBe(false);
  });

  it('rejects a payload that still carries the account e-mail links', () => {
    const leaky = {
      ...summary,
      customers: { ...summary.customers, accountSellerLinks },
    };
    expect(ConfigurationSummarySchema.safeParse(leaky).success).toBe(false);
  });

  it('parses a full configuration response', () => {
    const response = {
      contentHash: 'sha256:abc',
      configuration: summary,
      syncStates: [
        {
          entity: 'customers',
          status: 'failed',
          lastSuccessAt: null,
          lastAttemptAt: '2030-01-01T00:00:00.000Z',
          lastFullReconcileAt: null,
          rowCount: null,
          lastErrorClass: 'unavailable',
          lastErrorMessage: 'Integração indisponível',
        },
      ],
      gateway: { mode: 'fake' },
      integration: {
        state: 'degraded',
        gatewayMode: 'fake',
        lastSuccessAt: null,
        failingEntities: ['customers'],
        message: null,
      },
    };
    expect(ConfigurationResponseSchema.parse(response)).toEqual(response);
    expect(
      ConfigurationResponseSchema.safeParse({ ...response, gateway: { mode: 'other' } }).success,
    ).toBe(false);
  });
});
