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
    const file = raw as { source: { kind: string; version: string }; sales: Record<string, unknown>; erp: Record<string, unknown> };
    expect(file.source).toMatchObject({ kind: 'bootstrap-file', version: 'plac-staging-2026-11-03' });
    expect(file.sales['eligibleOrderTopCodes']).toEqual([1001, 1000]);
    expect(file.sales['quotationTopCode']).toBe(1000);
    expect(file.sales['topAllowlist']).toEqual([1000, 1001]);
    expect(file.sales['negotiationTypeExclusions']).toEqual([23, 24]);
    expect(file.sales['discountAuthority']).toMatchObject({ mode: 'erp' });
    expect(file.erp['liberationEventLabels']).toEqual({ '44': 'liberação exigida pela TOP', '18': 'confirmação de nota' });
  });

  it('holds configuration only: no credential-like text', () => {
    expect(readFileSync(FILE, 'utf8')).not.toMatch(/secret|password|x-token|bearer|authorization/i);
  });
});
