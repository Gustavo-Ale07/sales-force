/* eslint-disable @typescript-eslint/no-explicit-any -- tests patch deliberately malformed facts */
import {
  PLAC_CONFIGURATION_FACTS,
  PLAC_SANDBOX_CONFIGURATION_FACTS,
  PLAC_SANDBOX_ORDER_STATUS_ROWS,
  type ConfigurationFacts,
  type EnabledTopRow,
} from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { configurationContentHash } from '../../src/configuration/configuration-hash.js';
import { ConfigurationOverlayError, overlayConfigurationFacts } from '../../src/configuration/sankhya-overlay.js';
import { validateInstallationConfiguration } from '../../src/configuration/validate.js';
import { baseConfiguration } from '../helpers/overlay-base.js';

function factsWith(patch: (facts: Record<string, any>) => void): ConfigurationFacts {
  const facts = structuredClone(PLAC_CONFIGURATION_FACTS) as unknown as Record<string, any>;
  patch(facts);
  return facts as ConfigurationFacts;
}

const keyOf = (result: ReturnType<typeof overlayConfigurationFacts>, key: string) =>
  result.entries.find((entry) => entry.key === key);

describe('overlay base (+) Sankhya facts (CFG-8)', () => {
  const result = overlayConfigurationFacts({ base: baseConfiguration(), facts: PLAC_CONFIGURATION_FACTS });
  const snapshot = result.snapshot as any;

  it('produces a snapshot valid for the contracts schema and the domain consistency rules', () => {
    expect(validateInstallationConfiguration(structuredClone(snapshot))).toMatchObject({ ok: true });
  });

  it('marks the snapshot as sankhya over the base file', () => {
    expect(snapshot.source).toEqual({
      kind: 'sankhya',
      version: 'sankhya-overlay:base-2026-10-02',
      syncedAt: PLAC_CONFIGURATION_FACTS.readAt,
      base: { kind: 'bootstrap-file', version: 'base-2026-10-02' },
    });
  });

  it('applies the bridge keys (PLAC values)', () => {
    expect(snapshot.general.enabledCompanyCodes).toEqual([1]);
    expect(snapshot.general.defaultCompanyCode).toBe(1);
    expect(snapshot.sales.orderTopCode).toBe(1001);
    expect(snapshot.sales.quoteTopCodes).toEqual([1051]);
    expect(snapshot.sales.quotationTopCode).toBe(1051);
    expect(snapshot.sales.skipConfirmationTopCodes).toEqual([1000]);
    expect(snapshot.sales.orderStockLocationCode).toBe(209);
    expect(snapshot.sales.orderBehavior.decimalQuantities).toBe(true);
    expect(snapshot.pricing.mobilePriceTableCodes).toEqual([5]);
    expect(snapshot.pricing.catalogReferenceTableCode).toBe(5);
    expect(snapshot.customers.historyDays).toBe(90);
    expect(snapshot.customers.purchasedWindowDays).toBe(90);
    expect(snapshot.erp.orderStatusDisplay).toHaveLength(8);
    expect(snapshot.erp.orderStatusDisplay[0]).toMatchObject({ code: '1', color: '#9E9E9E' });
  });

  it('topAllowlist intersects the order TOPs (7 enabled, 2 allowed)', () => {
    expect(snapshot.sales.eligibleOrderTopCodes).toEqual([1000, 1001]);
  });

  it('without an allowlist the whole Sankhya order list is eligible', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        delete c['sales'].topAllowlist;
      }),
      facts: PLAC_CONFIGURATION_FACTS,
    });
    expect((out.snapshot as any).sales.eligibleOrderTopCodes).toEqual([1000, 1001, 1009, 1051, 1061, 2209, 2309]);
  });

  it('an allowlisted TOP that Sankhya does not enable is left out with a warning', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['sales'].topAllowlist = [1000, 1001, 9999];
      }),
      facts: PLAC_CONFIGURATION_FACTS,
    });
    expect((out.snapshot as any).sales.eligibleOrderTopCodes).toEqual([1000, 1001]);
    expect(out.warnings.map((w) => w.code)).toContain('allowlist_top_not_enabled');
  });

  it('negotiation types: 35 enabled minus the exclusions (23, 24) = 33, labels from Sankhya', () => {
    const types = snapshot.sales.negotiationTypes as { code: number; label: string }[];
    expect(types).toHaveLength(33);
    expect(types.some((t) => t.code === 23 || t.code === 24)).toBe(false);
    expect(types[1]).toEqual({ code: 2, label: 'Condicao sintetica 2' });
  });

  it('inactive negotiation types are dropped; the sellable flag of the base is kept', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['sales'].negotiationTypes[4] = { code: 5, label: 'x', sellable: false };
      }),
      facts: factsWith((f) => {
        f['q5NegotiationTypes'].rows[2].active = false;
      }),
    });
    const types = (out.snapshot as any).sales.negotiationTypes as { code: number; sellable?: boolean }[];
    expect(types.find((t) => t.code === 3)).toBeUndefined();
    expect(types.find((t) => t.code === 5)?.sellable).toBe(false);
    expect(types.find((t) => t.code === 2)?.sellable).toBeUndefined();
  });

  it('the alternative table takes the code from Sankhya; active stays with the base; absent base = inactive, unvalidated', () => {
    expect(snapshot.pricing.alternativeTable).toEqual({ tableCode: 5, validation: 'needs_validation', active: false });
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['pricing'].alternativeTable = { tableCode: 99, validation: 'validated', active: true };
      }),
      facts: PLAC_CONFIGURATION_FACTS,
    });
    expect((out.snapshot as any).pricing.alternativeTable).toEqual({ tableCode: 5, validation: 'validated', active: true });
  });

  it('never takes the fallback table or the Force-only keys from Sankhya', () => {
    expect(snapshot.pricing.fallbackTableCode).toBeNull();
    expect(snapshot.pricing.fallbackStrategy).toBe('none');
    expect(snapshot.sales.topAllowlist).toEqual([1000, 1001]);
    expect(snapshot.sales.negotiationTypeExclusions).toEqual([23, 24]);
    expect(snapshot.general.appMinimumVersion).toBe('1.0.0');
    expect(snapshot.sales.confirmationBehavior).toBe('disabled');
  });

  it('UTILFINANC overrides showFinancialArea, with provenance (D-I)', () => {
    expect(snapshot.financial.showFinancialArea).toBe(true);
    expect(result.informational.usesFinancial).toBe(true);
    const entry = result.entries.find((e) => e.key === 'financial.showFinancialArea');
    expect(entry).toMatchObject({ next: true, origin: 'AD_TVDYCFGFRC.UTILFINANC' });
    expect(snapshot.provenance['financial.showFinancialArea']).toMatchObject({ table: 'AD_TVDYCFGFRC', column: 'UTILFINANC' });
  });

  it('a NULL UTILFINANC keeps the base showFinancialArea', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['financial'].showFinancialArea = false;
      }),
      facts: factsWith((f) => {
        f['q1GeneralParameters'].rows[0].usesFinancial = null;
      }),
    });
    expect((out.snapshot as any).financial.showFinancialArea).toBe(false);
    expect(keyOf(out, 'financial.showFinancialArea')).toBeUndefined();
  });

  it('reports Q8 and the parameters without a feature, never applied', () => {
    expect(result.informational.productMobility).toEqual([
      { mobile: true, count: 120 },
      { mobile: false, count: 80 },
      { mobile: null, count: 5 },
    ]);
    expect(result.informational.parametersWithoutFeature).toEqual({});
  });

  it('report entries carry previous, new and origin, and flag what changed', () => {
    expect(keyOf(result, 'pricing.catalogReferenceTableCode')).toEqual({
      key: 'pricing.catalogReferenceTableCode',
      previous: null,
      next: 5,
      origin: 'AD_TVDYCFGFRC.TABPADCSLTPROD',
      changed: true,
    });
    expect(keyOf(result, 'sales.orderTopCode')).toMatchObject({ previous: 1001, next: 1001, changed: false });
    expect(keyOf(result, 'sales.negotiationTypes')).toMatchObject({ changed: true, origin: 'TGFTPV.AD_MOBILIDADE' });
  });

  it('provenance: Sankhya table/column/readAt for read keys, source base for base keys', () => {
    expect(snapshot.provenance['pricing.catalogReferenceTableCode']).toEqual({
      table: 'AD_TVDYCFGFRC',
      column: 'TABPADCSLTPROD',
      filter: 'NUCFG = 1',
      readAt: PLAC_CONFIGURATION_FACTS.readAt,
    });
    expect(snapshot.provenance['sales.topAllowlist']).toEqual({ source: 'base' });
    // fallbackTableCode is null in this base: nothing to attribute, and Sankhya never provides it.
    expect(snapshot.provenance['pricing.fallbackTableCode']).toBeUndefined();
    expect(snapshot.provenance['financial.showFinancialArea']).toMatchObject({ table: 'AD_TVDYCFGFRC', column: 'UTILFINANC' });
  });

  it('does not mutate the base', () => {
    const base = baseConfiguration();
    const copy = structuredClone(base);
    overlayConfigurationFacts({ base, facts: PLAC_CONFIGURATION_FACTS });
    expect(base).toEqual(copy);
  });

  it('is deterministic: the same facts read later give the same content hash', () => {
    const later = { ...structuredClone(PLAC_CONFIGURATION_FACTS), readAt: '2031-01-01T00:00:00.000Z' };
    const again = overlayConfigurationFacts({ base: baseConfiguration(), facts: later as ConfigurationFacts });
    expect(configurationContentHash(again.snapshot)).toBe(configurationContentHash(result.snapshot));
    const changed = overlayConfigurationFacts({
      base: baseConfiguration(),
      facts: factsWith((f) => {
        f['q1GeneralParameters'].rows[0].historyDays = 30;
      }),
    });
    expect(configurationContentHash(changed.snapshot)).not.toBe(configurationContentHash(result.snapshot));
  });
});

describe('overlay decision table: preconditions that keep the base and warn', () => {
  const codes = (out: ReturnType<typeof overlayConfigurationFacts>) => out.warnings.map((w) => w.code);

  it('several enabled companies: the base default company is kept', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['general'].enabledCompanyCodes = [1, 2];
      }),
      facts: factsWith((f) => {
        f['q2Companies'].rows[1].mobile = true;
      }),
    });
    const snap = out.snapshot as any;
    expect(snap.general.enabledCompanyCodes).toEqual([1, 2]);
    expect(snap.general.defaultCompanyCode).toBe(1);
    expect(codes(out)).toContain('several_companies_enabled');
    expect(keyOf(out, 'general.defaultCompanyCode')).toBeUndefined();
  });

  it('no company enabled / flags empty: the base list is kept', () => {
    const none = overlayConfigurationFacts({
      base: baseConfiguration(),
      facts: factsWith((f) => {
        f['q2Companies'].rows[0].mobile = false;
      }),
    });
    expect(codes(none)).toContain('no_company_enabled');
    expect((none.snapshot as any).general.enabledCompanyCodes).toEqual([1]);
    const unread = overlayConfigurationFacts({
      base: baseConfiguration(),
      facts: factsWith((f) => {
        for (const row of f['q2Companies'].rows) row.mobile = null;
      }),
    });
    expect(codes(unread)).toContain('companies_not_read');
  });

  it('the company default TOP is absent from Q3: the base order TOP is kept', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['sales'].orderTopCode = 1000;
      }),
      facts: factsWith((f) => {
        f['q3EnabledTops'].rows = f['q3EnabledTops'].rows.filter((t: EnabledTopRow) => t.topCode !== 1001);
      }),
    });
    expect((out.snapshot as any).sales.orderTopCode).toBe(1000);
    expect(codes(out)).toContain('default_top_not_enabled');
  });

  it('the company default TOP is empty (null = not read): the base order TOP is kept', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration(),
      facts: factsWith((f) => {
        f['q2Companies'].rows[0].defaultOrderTopCode = null;
      }),
    });
    expect(codes(out)).toContain('default_top_not_read');
  });

  it('group ORCAMENTO absent: the base quotation TOP is kept and quoteTopCodes is not invented', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration(),
      facts: factsWith((f) => {
        f['q4TopGroups'].rows = f['q4TopGroups'].rows.filter((r: { groupName: string }) => r.groupName === 'PEDIDO');
      }),
    });
    const snap = out.snapshot as any;
    expect(snap.sales.quotationTopCode).toBe(1051);
    expect(snap.sales.quoteTopCodes).toBeUndefined();
    expect(codes(out)).toContain('quote_group_missing');
  });

  it('group name is matched without accents and case (Orçamento / ORCAMENTO)', () => {
    for (const name of ['Orçamento', 'orcamento', ' ORÇAMENTO ']) {
      const out = overlayConfigurationFacts({
        base: baseConfiguration(),
        facts: factsWith((f) => {
          for (const row of f['q4TopGroups'].rows) if (row.groupName === 'ORÇAMENTO') row.groupName = name;
        }),
      });
      expect((out.snapshot as any).sales.quoteTopCodes).toEqual([1051]);
    }
  });

  it('several quotation TOPs: quoteTopCodes is set, quotationTopCode keeps the base with a warning', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration(),
      facts: factsWith((f) => {
        f['q4TopGroups'].rows.push({ groupId: 2, groupName: 'ORÇAMENTO', order: 2, topCode: 1061 });
      }),
    });
    const snap = out.snapshot as any;
    expect(snap.sales.quoteTopCodes).toEqual([1051, 1061]);
    expect(snap.sales.quotationTopCode).toBe(1051);
    expect(codes(out)).toContain('several_quote_tops');
  });

  it('NULL cells are "not read", never false: Q1 nulls keep the base', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['sales'].orderBehavior.decimalQuantities = false;
        c['customers'].historyDays = 45;
      }),
      facts: factsWith((f) => {
        const row = f['q1GeneralParameters'].rows[0];
        row.decimalQuantities = null;
        row.historyDays = null;
        row.hidesCreditLimit = null;
      }),
    });
    const snap = out.snapshot as any;
    expect(snap.sales.orderBehavior.decimalQuantities).toBe(false);
    expect(snap.customers.historyDays).toBe(45);
    expect(snap.customers.creditFeatures.showCreditLimit).toBe(true);
  });

  it('OCLTLIMCRED is reported only: showCreditLimit follows the base file', () => {
    for (const [hides, baseShows] of [
      [true, true],
      [false, false],
    ] as const) {
      const out = overlayConfigurationFacts({
        base: baseConfiguration((c) => {
          c['customers'].creditFeatures.showCreditLimit = baseShows;
        }),
        facts: factsWith((f) => {
          f['q1GeneralParameters'].rows[0].hidesCreditLimit = hides;
        }),
      });
      expect((out.snapshot as any).customers.creditFeatures.showCreditLimit).toBe(baseShows);
      expect(out.informational.hidesCreditLimit).toBe(hides);
      expect(out.entries.some((e) => e.key === 'customers.creditFeatures.showCreditLimit')).toBe(false);
      expect((out.snapshot as any).provenance['customers.creditFeatures.showCreditLimit']).toEqual({ source: 'base' });
    }
  });

  describe('order status presentation (F4)', () => {
    const sandboxStatuses = (patch?: (rows: any[]) => void) =>
      factsWith((f) => {
        const rows = structuredClone(PLAC_SANDBOX_ORDER_STATUS_ROWS) as any[];
        patch?.(rows);
        f['q7OrderStatuses'].rows = rows;
      });
    const statusesOf = (out: ReturnType<typeof overlayConfigurationFacts>) => (out.snapshot as any).erp.orderStatusDisplay as any[];

    it('the 8 real Sandbox rows (NULL permissions) are all applied, NULL read as false, no warning', () => {
      const out = overlayConfigurationFacts({ base: baseConfiguration(), facts: sandboxStatuses() });
      const list = statusesOf(out);
      expect(list.map((s) => s.code)).toEqual(['-1', '0', '1', '2', '3', '4', '5', '6']);
      expect(list.find((s) => s.code === '-1')).toEqual({
        code: '-1', label: 'DESCONHECIDO', color: '#BDBDBD', canEdit: false, canDuplicate: false, canDelete: false,
      });
      expect(list.find((s) => s.code === '0')).toMatchObject({ canEdit: false });
      expect(list.find((s) => s.code === '1')).toMatchObject({ canEdit: true, canDuplicate: true, canDelete: true });
      expect(codes(out).filter((c) => c.startsWith('status_') || c === 'no_order_status')).toEqual([]);
      expect(keyOf(out, 'erp.orderStatusDisplay')).toBeDefined();
      expect(validateInstallationConfiguration(structuredClone(out.snapshot)).ok).toBe(true);
    });

    it('a missing or invalid colour means no colour and does not invalidate the row', () => {
      const out = overlayConfigurationFacts({
        base: baseConfiguration(),
        facts: sandboxStatuses((rows) => {
          rows[2].color = null;
          rows[3].color = 'ZZZ';
        }),
      });
      const list = statusesOf(out);
      expect(list).toHaveLength(8);
      expect(list.find((s) => s.code === '1')).not.toHaveProperty('color');
      expect(list.find((s) => s.code === '2')).not.toHaveProperty('color');
      expect(validateInstallationConfiguration(structuredClone(out.snapshot)).ok).toBe(true);
    });

    it('S is true, N is false, any other value is false with status_flag_invalid naming status and column', () => {
      const out = overlayConfigurationFacts({
        base: baseConfiguration(),
        facts: sandboxStatuses((rows) => {
          rows[3].canEdit = true;
          rows[4].invalidFlags = ['PERMEXC'];
        }),
      });
      expect(statusesOf(out).find((s) => s.code === '2')).toMatchObject({ canEdit: true });
      const invalid = out.warnings.filter((w) => w.code === 'status_flag_invalid');
      expect(invalid).toHaveLength(1);
      expect(invalid[0]?.message).toContain('status 3');
      expect(invalid[0]?.message).toContain('PERMEXC');
      expect(statusesOf(out).find((s) => s.code === '3')).toMatchObject({ canDelete: false });
    });

    it('a row without CODSTATUS or without NOME is dropped alone, with the status code in the warning', () => {
      const out = overlayConfigurationFacts({
        base: baseConfiguration(),
        facts: sandboxStatuses((rows) => {
          rows[6].name = null;
          rows[7].code = null;
        }),
      });
      expect(statusesOf(out)).toHaveLength(6);
      const incomplete = out.warnings.filter((w) => w.code === 'status_incomplete');
      expect(incomplete).toHaveLength(2);
      expect(incomplete[0]?.message).toContain('status 5');
      expect(incomplete[1]?.message).toContain('no CODSTATUS');
      expect(codes(out)).not.toContain('no_order_status');
      expect(keyOf(out, 'erp.orderStatusDisplay')).toBeDefined();
    });

    it('a duplicate CODSTATUS keeps the first row (warning) and a name over 200 characters is truncated', () => {
      const out = overlayConfigurationFacts({
        base: baseConfiguration(),
        facts: sandboxStatuses((rows) => {
          rows.push({ ...rows[2], name: 'OUTRO', canEdit: true });
          rows[3].name = 'N'.repeat(300);
        }),
      });
      const list = statusesOf(out);
      expect(list).toHaveLength(8);
      expect(list.find((s) => s.code === '1')).toMatchObject({ label: 'NAO CONFIRMADO' });
      expect(list.find((s) => s.code === '2').label).toHaveLength(200);
      expect(codes(out).filter((c) => c === 'status_duplicate')).toHaveLength(1);
      expect(validateInstallationConfiguration(structuredClone(out.snapshot)).ok).toBe(true);
    });

    it('no_order_status only when no row remains; the base value is kept', () => {
      const out = overlayConfigurationFacts({
        base: baseConfiguration(),
        facts: sandboxStatuses((rows) => {
          for (const row of rows) row.name = null;
        }),
      });
      expect(codes(out)).toContain('no_order_status');
      expect(keyOf(out, 'erp.orderStatusDisplay')).toBeUndefined();
    });
  });

  it('the scope summary (F5) has counts and codes only', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['sales'].negotiationTypeExclusions = [23, 24];
      }),
      facts: factsWith((f) => {
        const rows = f['q5NegotiationTypes'].rows;
        rows.push({ code: 23, description: 'Excluida', active: true, mobile: true, sale: null, changedAt: null });
        rows.push({ code: 99, description: 'Inativa', active: false, mobile: true, sale: null, changedAt: null });
      }),
    });
    const summary = out.scopeSummary;
    expect(summary.negotiationTypes.read).toBe(
      summary.negotiationTypes.result + summary.negotiationTypes.inactive + summary.negotiationTypes.excludedByBase,
    );
    expect(summary.negotiationTypes.inactive).toBeGreaterThanOrEqual(1);
    expect(summary.negotiationTypes.excludedByBase).toBeGreaterThanOrEqual(1);
    expect(summary.negotiationTypes.codes).not.toContain(23);
    expect(summary.negotiationTypes.codes).not.toContain(99);
    expect(summary.negotiationTypes.codes).toEqual((out.snapshot as any).sales.negotiationTypes.map((t: any) => t.code));
    expect(summary.eligibleOrderTops.codes).toEqual((out.snapshot as any).sales.eligibleOrderTopCodes);
    expect(summary.eligibleOrderTops.read).toBe(7);
    expect(summary.eligibleOrderTops.outsideAllowlist).toBe(5);
    expect(JSON.stringify(summary)).not.toMatch(/Excluida|Inativa|description/);
  });

  it('no mobile price table: the base list is kept', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration(),
      facts: factsWith((f) => {
        for (const row of f['q6PriceTables'].rows) row.mobile = false;
      }),
    });
    expect((out.snapshot as any).pricing.mobilePriceTableCodes).toEqual([5, 6, 7]);
    expect(codes(out)).toContain('no_mobile_price_table');
  });

  it('non-sale TOP movement types (TIPMOV other than P) are not order TOPs', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        delete c['sales'].topAllowlist;
      }),
      facts: factsWith((f) => {
        f['q3EnabledTops'].rows.find((t: EnabledTopRow) => t.topCode === 2309).movementType = 'V';
      }),
    });
    expect((out.snapshot as any).sales.eligibleOrderTopCodes).not.toContain(2309);
  });

  it('a failed query or a Q1 without exactly one row throws a permanent error and applies nothing', () => {
    const failed = factsWith((f) => {
      f['q3EnabledTops'] = { ok: false, source: f['q3EnabledTops'].source, error: { kind: 'permanent', code: 'x', message: 'x', retryable: false } };
    });
    expect(() => overlayConfigurationFacts({ base: baseConfiguration(), facts: failed })).toThrow(ConfigurationOverlayError);
    const noRow = factsWith((f) => {
      f['q1GeneralParameters'].rows = [];
    });
    expect(() => overlayConfigurationFacts({ base: baseConfiguration(), facts: noRow })).toThrow(/exactly one row/);
  });

  it('a value out of domain survives the overlay and is refused by schema validation', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration(),
      facts: factsWith((f) => {
        f['q1GeneralParameters'].rows[0].historyDays = 99999;
      }),
    });
    expect(validateInstallationConfiguration(structuredClone(out.snapshot))).toMatchObject({ ok: false });
  });

  it('a base default negotiation type missing from Sankhya is refused by the consistency rules (fail closed)', () => {
    const out = overlayConfigurationFacts({
      base: baseConfiguration((c) => {
        c['sales'].defaultNegotiationTypeCode = 23;
        c['sales'].negotiationTypes.push({ code: 23, label: 'devolucao' });
      }),
      facts: PLAC_CONFIGURATION_FACTS,
    });
    expect(validateInstallationConfiguration(structuredClone(out.snapshot))).toMatchObject({ ok: false });
  });
});

describe('overlay over a Sandbox-shaped Q1 (columns absent from this ERP schema)', () => {
  it('reports each absent informational column as a column_missing warning and applies the same keys', () => {
    const production = overlayConfigurationFacts({ base: baseConfiguration(), facts: PLAC_CONFIGURATION_FACTS });
    const sandbox = overlayConfigurationFacts({ base: baseConfiguration(), facts: PLAC_SANDBOX_CONFIGURATION_FACTS });

    expect(sandbox.warnings.filter((warning) => warning.code === 'column_missing').map((warning) => warning.key)).toEqual([
      'AD_TVDYCFGFRC.BLOQVENDCLIBLOQ',
      'AD_TVDYCFGFRC.EXIBLIMCRECAR',
    ]);
    expect(production.warnings.some((warning) => warning.code === 'column_missing')).toBe(false);
    expect(sandbox.entries.map((entry) => entry.key)).toEqual(production.entries.map((entry) => entry.key));
    expect(configurationContentHash(sandbox.snapshot)).toBe(configurationContentHash(production.snapshot));
    expect(Object.keys(sandbox.informational.parametersWithoutFeature)).not.toContain('BLOQVENDCLIBLOQ');
  });
});
