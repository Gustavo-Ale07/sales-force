import { describe, expect, it } from 'vitest';
import { ERP_ORDER_STATUS_LABELS, isFinalErpStatus, mapErpOrderStatus, type ErpOrderStatusFacts } from '../src/erp-order-status.js';

const base: ErpOrderStatusFacts = {
  found: true,
  cancelled: false,
  confirmed: true,
  awaitingRelease: false,
  awaitingBilling: false,
  invoiced: false,
  invoiceStatus: null,
};

describe('mapErpOrderStatus decision table (P2)', () => {
  const table: [string, Partial<ErpOrderStatusFacts>, number, string][] = [
    ['not found', { found: false }, -1, 'DESCONHECIDO'],
    ['not found beats everything', { found: false, cancelled: true, invoiced: true, invoiceStatus: 'A' }, -1, 'DESCONHECIDO'],
    ['cancelled', { cancelled: true }, 0, 'CANCELADO'],
    ['cancelled beats invoiced', { cancelled: true, invoiced: true, invoiceStatus: 'A' }, 0, 'CANCELADO'],
    ['invoiced and authorised', { invoiced: true, invoiceStatus: 'A' }, 4, 'FATURADO'],
    ['invoiced, status not authorised (quirk: NEGADO overrides FATURADO)', { invoiced: true, invoiceStatus: 'D' }, 5, 'NEGADO'],
    ['invoiced, status unreadable', { invoiced: true, invoiceStatus: null }, 5, 'NEGADO'],
    ['invoiced beats awaiting release', { invoiced: true, invoiceStatus: 'A', awaitingRelease: true }, 4, 'FATURADO'],
    ['awaiting release', { awaitingRelease: true }, 6, 'AGUARDANDO LIBERAÇÃO'],
    ['awaiting release beats not confirmed', { awaitingRelease: true, confirmed: false }, 6, 'AGUARDANDO LIBERAÇÃO'],
    ['not confirmed', { confirmed: false }, 1, 'NÃO CONFIRMADO'],
    ['confirmed awaiting billing', { awaitingBilling: true }, 3, 'AGUARDANDO FATURAMENTO'],
    ['not confirmed ignores awaiting billing', { confirmed: false, awaitingBilling: true }, 1, 'NÃO CONFIRMADO'],
    ['confirmed', {}, 2, 'CONFIRMADO'],
  ];
  it.each(table)('%s', (_name, over, code, label) => {
    expect(mapErpOrderStatus({ ...base, ...over })).toEqual({ code, label });
  });

  it('has a label for every code and only cancelled/invoiced are final', () => {
    expect(Object.keys(ERP_ORDER_STATUS_LABELS).sort()).toEqual(['-1', '0', '1', '2', '3', '4', '5', '6']);
    expect([-1, 0, 1, 2, 3, 4, 5, 6].filter((c) => isFinalErpStatus(c as never))).toEqual([0, 4]);
  });
});
