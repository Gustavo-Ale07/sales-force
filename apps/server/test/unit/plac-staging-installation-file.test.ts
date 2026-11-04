import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEMO_ACCOUNTS } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { bootstrapConfigurationProblems } from '../../src/configuration/bootstrap-guard.js';
import { validateInstallationConfiguration } from '../../src/configuration/validate.js';

const FILE = resolve(import.meta.dirname, '../../../../.claude/work/PLAC_STAGING_INSTALLATION.json');
const raw: unknown = JSON.parse(readFileSync(FILE, 'utf8'));

describe('PLAC staging base file (.claude/work/PLAC_STAGING_INSTALLATION.json)', () => {
  it('passes the config-bootstrap validator (schema + consistency rules) and its guard', () => {
    const result = validateInstallationConfiguration(raw);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const configuration = result.value as unknown as Parameters<typeof bootstrapConfigurationProblems>[0];
    expect(bootstrapConfigurationProblems(configuration, DEMO_ACCOUNTS.map((a) => a.email))).toEqual([]);
  });

  it('carries the 2026-11-03 decisions', () => {
    const file = raw as {
      source: { kind: string; version: string };
      sales: Record<string, unknown>;
      erp: Record<string, unknown>;
      financial: Record<string, unknown>;
    };
    expect(file.source).toMatchObject({ kind: 'bootstrap-file', version: 'plac-staging-2026-11-04' });
    // D-I: read-only financial area on; credit checks stay off (nothing blocks a sale).
    expect(file.financial).toEqual({ showFinancialArea: true, overdueTitles: true, creditChecks: false });
    expect(file.sales['eligibleOrderTopCodes']).toEqual([1001, 1000]);
    expect(file.sales['expedicaoDefault']).toBe('N'); // D-O
    expect(file.sales['quotationTopCode']).toBe(1000);
    // D-V: Sankhya is the only source; no fixed TOP / negotiation code lists in the base file.
    expect(file.sales['topAllowlist']).toBeUndefined();
    expect(file.sales['negotiationTypeExclusions']).toBeUndefined();
    // D-S: catalogue filtered by mobility, products without price hidden.
    expect((file as unknown as { products: Record<string, unknown> }).products).toMatchObject({
      mobilityFilter: { mode: 'enforced', validation: 'validated' },
      productWithoutPrice: { visible: false, orderable: false },
    });
    expect(file.sales['discountAuthority']).toMatchObject({ mode: 'erp' });
    expect(file.erp['liberationEventLabels']).toEqual({ '44': 'liberação exigida pela TOP', '18': 'confirmação de nota' });
  });

  it('holds configuration only: no credential-like text', () => {
    expect(readFileSync(FILE, 'utf8')).not.toMatch(/secret|password|x-token|bearer|authorization/i);
  });
});
