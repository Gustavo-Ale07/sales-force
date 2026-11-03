import { ConfigurationSummarySchema } from '@salesforce/contracts';
import { describe, expect, it } from 'vitest';
import { toConfigurationSummary } from '../../src/configuration/configuration-summary.js';
import { baseConfiguration } from '../helpers/overlay-base.js';

describe('toConfigurationSummary: CFG-8 keys for the read-only settings screen (W-38)', () => {
  const config = baseConfiguration((c) => {
    c['sales'].quoteTopCodes = [1000];
    c['sales'].skipConfirmationTopCodes = [];
    c['sales'].orderStockLocationCode = 209;
    c['sales'].orderBehavior.decimalQuantities = true;
    c['customers'].historyDays = 30;
    c['customers'].purchasedWindowDays = 90;
    c['erp'] = {
      liberationEventLabels: { '44': 'liberação exigida pela TOP' },
      orderStatusDisplay: [{ code: 'P', label: 'Pendente', color: '#AA0000', canEdit: true, canDuplicate: true, canDelete: false }],
    };
    c['provenance'] = { 'customers.historyDays': { table: 'AD_TVDYCFGFRC', column: 'DIASCONSULTAVENDAS', readAt: '2026-11-03T12:00:00.000Z' } };
  });
  const summary = toConfigurationSummary(config);

  it('carries the new keys and still satisfies the contract', () => {
    expect(ConfigurationSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.general.appMinimumVersion).toBe('1.0.0');
    expect(summary.sales.eligibleOrderTopCodes).toEqual([1001]);
    expect(summary.sales.topAllowlist).toEqual([1000, 1001]);
    expect(summary.sales.negotiationTypeExclusions).toEqual([23, 24]);
    expect(summary.sales.quoteTopCodes).toEqual([1000]);
    expect(summary.sales.skipConfirmationTopCodes).toEqual([]);
    expect(summary.sales.orderStockLocationCode).toBe(209);
    expect(summary.sales.orderBehavior.decimalQuantities).toBe(true);
    expect(summary.customers.historyDays).toBe(30);
    expect(summary.customers.purchasedWindowDays).toBe(90);
    expect(summary.erp?.liberationEventLabels).toEqual({ '44': 'liberação exigida pela TOP' });
    expect(summary.erp?.orderStatusDisplay?.[0]?.code).toBe('P');
  });

  it('never carries the discount limits or the account e-mails', () => {
    const text = JSON.stringify(
      toConfigurationSummary(
        baseConfiguration((c) => {
          c['sales'].discountAuthority = { mode: 'force', limits: { seller: '5', manager: '10', director: '15' } };
          c['customers'].accountSellerLinks = [{ accountEmail: 'a@example.test', sellerCode: 1 }];
        }),
      ),
    );
    expect(text).not.toContain('a@example.test');
    expect(text).not.toContain('"limits"');
  });
});
