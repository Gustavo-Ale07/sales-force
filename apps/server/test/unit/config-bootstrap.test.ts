import { DEMO_ACCOUNTS, DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { defaultUnconfiguredConfiguration, type InstallationConfiguration } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import { parseConfigBootstrapEnv } from '../../src/config/config-bootstrap-env.js';
import { EnvValidationError } from '../../src/config/env.js';
import { bootstrapConfigurationProblems } from '../../src/configuration/bootstrap-guard.js';

const DATABASE_URL = 'postgres://force_migrator:not-a-real-password@postgres:5432/db';
const demoEmails = DEMO_ACCOUNTS.map((account) => account.email);

function problemsOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected an EnvValidationError');
}

describe('config-bootstrap environment (staging / production only)', () => {
  it('accepts production with a database URL and a file path (the database host may be remote)', () => {
    const env = parseConfigBootstrapEnv({ NODE_ENV: 'production', DATABASE_URL, INSTALLATION_CONFIG_FILE: '/config/installation.json' });
    expect(env.INSTALLATION_CONFIG_FILE).toBe('/config/installation.json');
  });

  it('refuses development and test (the dev seed is the development path)', () => {
    for (const nodeEnv of ['development', 'test']) {
      expect(problemsOf(() => parseConfigBootstrapEnv({ NODE_ENV: nodeEnv, DATABASE_URL, INSTALLATION_CONFIG_FILE: '/c.json' }))).toEqual([
        expect.stringMatching(/^NODE_ENV: .*staging\/production only/),
      ]);
    }
  });

  it('requires NODE_ENV, the database URL and the file, naming variables only', () => {
    const problems = problemsOf(() => parseConfigBootstrapEnv({}));
    expect(problems).toEqual([
      expect.stringMatching(/^NODE_ENV:/),
      expect.stringMatching(/^DATABASE_URL:/),
      expect.stringMatching(/^INSTALLATION_CONFIG_FILE:/),
    ]);
  });
});

describe('config-bootstrap content guard', () => {
  const clean: InstallationConfiguration = {
    ...DEMO_CONFIGURATION,
    customers: { ...DEMO_CONFIGURATION.customers, accountSellerLinks: [{ accountEmail: 'vendedor@cliente.example', sellerCode: 5 }] },
    features: {},
  };

  it('passes a configuration without demo accounts or demo metrics', () => {
    expect(bootstrapConfigurationProblems(clean, demoEmails)).toEqual([]);
    expect(bootstrapConfigurationProblems(defaultUnconfiguredConfiguration(), demoEmails)).toEqual([]);
  });

  it('refuses the demo configuration, naming fields and never values', () => {
    const problems = bootstrapConfigurationProblems(DEMO_CONFIGURATION, demoEmails);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/^customers\.accountSellerLinks\.0\.accountEmail: /);
    expect(problems.some((p) => p.startsWith('features.demoMetrics'))).toBe(true);
    expect(problems.join(' ')).not.toContain('demo.salesforce.local');
  });

  it('matches demo addresses case-insensitively', () => {
    const upper = {
      ...clean,
      customers: { ...clean.customers, accountSellerLinks: [{ accountEmail: ' ADMIN@Demo.SalesForce.Local ', sellerCode: 5 }] },
    };
    expect(bootstrapConfigurationProblems(upper, demoEmails)).toHaveLength(1);
  });
});
