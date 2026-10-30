import { describe, expect, it } from 'vitest';
import {
  InstallationConfigurationSchema,
  configurationHashView,
  type InstallationConfiguration,
} from '../src/index.js';
import { makeConfig } from './fixtures.js';

const ok = (input: unknown) => InstallationConfigurationSchema.safeParse(input).success;

const sankhya = (): InstallationConfiguration =>
  makeConfig((c) => ({
    ...c,
    source: {
      kind: 'sankhya',
      version: 'cfg-1',
      syncedAt: '2030-01-01T00:00:00.000Z',
      base: { kind: 'bootstrap-file', version: 'sha256:abc123' },
    },
    general: { ...c.general, appMinimumVersion: '1.2.0' },
    sales: {
      ...c.sales,
      topAllowlist: [4100, 4101],
      negotiationTypeExclusions: [9],
      quoteTopCodes: [4200],
      skipConfirmationTopCodes: [4101],
      orderBehavior: { ...c.sales.orderBehavior, decimalQuantities: true },
    },
    erp: {
      orderStatusDisplay: [
        { code: 'A', label: 'Aberto', color: '#00AA11', canEdit: true, canDuplicate: true, canDelete: false },
      ],
    },
    customers: { ...c.customers, historyDays: 90, purchasedWindowDays: 180 },
    provenance: {
      'sales.topAllowlist': {
        table: 'AD_TOPS',
        column: 'CODTIPOPER',
        filter: 'ATIVO = 1',
        readAt: '2030-01-01T00:00:00.000Z',
      },
      'sales.orderTopCode': { source: 'base' },
    },
  }));

describe('Sankhya-sourced configuration (CFG-8, expand-only)', () => {
  it('keeps an old bootstrap file valid unchanged', () => {
    expect(ok(makeConfig())).toBe(true);
  });

  it('accepts and round-trips the new optional keys and provenance', () => {
    const cfg = sankhya();
    expect(InstallationConfigurationSchema.parse(cfg)).toEqual(cfg);
  });

  it('rejects an invalid hex color, non-integer ints and a wrong base kind', () => {
    const bad = (patch: (c: InstallationConfiguration) => unknown) => ok(patch(sankhya()));
    const withStatus = (color: string) => (c: InstallationConfiguration) => ({
      ...c,
      erp: { orderStatusDisplay: [{ ...c.erp!.orderStatusDisplay![0]!, color }] },
    });
    expect(bad(withStatus('red'))).toBe(false);
    expect(bad(withStatus('#12345'))).toBe(false);
    expect(bad(withStatus('#12345G'))).toBe(false);
    expect(bad((c) => ({ ...c, sales: { ...c.sales, topAllowlist: [1.5] } }))).toBe(false);
    expect(bad((c) => ({ ...c, sales: { ...c.sales, quoteTopCodes: ['x'] } }))).toBe(false);
    expect(bad((c) => ({ ...c, customers: { ...c.customers, historyDays: 1.5 } }))).toBe(false);
    expect(bad((c) => ({ ...c, customers: { ...c.customers, purchasedWindowDays: -1 } }))).toBe(false);
    expect(bad((c) => ({ ...c, source: { ...c.source, base: { kind: 'demo', version: 'x' } } }))).toBe(false);
    expect(bad((c) => ({ ...c, provenance: { k: { table: 'T' } } }))).toBe(false);
    expect(bad((c) => ({ ...c, provenance: { k: { source: 'other' } } }))).toBe(false);
  });
});

describe('configurationHashView', () => {
  it('ignores source.syncedAt and provenance readAt', () => {
    const a = sankhya();
    const b = structuredClone(a);
    b.source.syncedAt = '2031-05-05T00:00:00.000Z';
    (b.provenance!['sales.topAllowlist'] as { readAt: string }).readAt = '2031-05-05T00:00:00.000Z';
    expect(configurationHashView(b)).toEqual(configurationHashView(a));
  });

  it('still reflects real content, provenance location and base changes', () => {
    const a = sankhya();
    const content = structuredClone(a);
    content.sales.topAllowlist = [4100];
    const loc = structuredClone(a);
    (loc.provenance!['sales.topAllowlist'] as { column: string }).column = 'OTHER';
    const base = structuredClone(a);
    base.source.base = { kind: 'bootstrap-file', version: 'sha256:def' };
    for (const changed of [content, loc, base]) {
      expect(configurationHashView(changed)).not.toEqual(configurationHashView(a));
    }
  });

  it('does not mutate its input and works without provenance', () => {
    const a = makeConfig();
    const copy = structuredClone(a);
    const view = configurationHashView(a) as { source: Record<string, unknown> };
    expect(a).toEqual(copy);
    expect('syncedAt' in view.source).toBe(false);
  });
});
