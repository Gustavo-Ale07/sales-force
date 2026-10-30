import { describe, expect, it } from 'vitest';
import {
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  formatDocumentQuantity,
  renderOrderHtml,
  toOrderDocument,
  type OrderDocumentSource,
} from '../src/index.js';

const source: OrderDocumentSource = {
  draftNumber: 42,
  erpNumber: 987654,
  customerCode: 1500,
  customerName: 'CASA & CIA LTDA',
  statusLabel: 'Enviado ao Sankhya',
  createdAt: '2026-03-31T01:30:00.000Z',
  notes: 'Entregar pela manhã',
  items: [
    {
      lineNo: 1,
      productCode: 10,
      productDescription: 'Cabo flexível 2,5mm',
      unit: 'RL',
      quantity: '1250.5',
      unitListPrice: '12.3456',
      discountPercent: '10',
      estimatedLineTotal: '13890.29',
    },
    {
      lineNo: 2,
      productCode: 11,
      productDescription: 'Tomada',
      unit: 'UN',
      quantity: '3',
      unitListPrice: null,
      discountPercent: '0',
      estimatedLineTotal: null,
    },
  ],
  totals: { estimatedTotal: '13890.29', isPartial: true, unpricedLineCount: 1 },
};

describe('pt-BR formatting without number', () => {
  it('formats money, quantity (up to 4 places) and percent', () => {
    expect(formatDocumentMoney('1234567.5')).toBe('R$ 1.234.567,50');
    expect(formatDocumentMoney('12.3456')).toBe('R$ 12,3456');
    expect(formatDocumentQuantity('1250.5000')).toBe('1.250,5');
    expect(formatDocumentQuantity('0.0125')).toBe('0,0125');
    expect(formatDocumentQuantity('3')).toBe('3');
    expect(formatDocumentPercent('10.50')).toBe('10,5%');
    expect(formatDocumentPercent('0')).toBe('—');
  });

  it('falls back to a dash for malformed values, never an exception', () => {
    expect(formatDocumentMoney('abc')).toBe('—');
    expect(formatDocumentQuantity('')).toBe('—');
  });

  it('formats the date in the business time zone (UTC-3)', () => {
    expect(formatDocumentDate('2026-03-31T01:30:00.000Z')).toBe('30/03/2026');
    expect(formatDocumentDate('2026-03-31T12:00:00.000Z')).toBe('31/03/2026');
    expect(formatDocumentDate('not a date')).toBe('—');
  });
});

describe('renderOrderHtml', () => {
  const html = renderOrderHtml(toOrderDocument(source));

  it('carries the brand, numbers, customer, items, totals and note', () => {
    expect(html).toContain('#01136A');
    expect(html).toContain('#FF0109');
    expect(html).toContain('@page');
    expect(html).toContain('A4');
    expect(html).toContain('Pedido Force nº 42');
    expect(html).toContain('Pedido Sankhya nº 987654');
    expect(html).toContain('Enviado ao Sankhya');
    expect(html).toContain('CASA &amp; CIA LTDA');
    expect(html).toContain('1.250,5');
    expect(html).toContain('R$ 12,3456');
    expect(html).toContain('10%');
    expect(html).toContain('R$ 13.890,29');
    expect(html).toContain('Sem preço');
    expect(html).toContain('parcial');
    expect(html).toContain('Entregar pela manhã');
    expect(html).toContain('30/03/2026');
  });

  it('omits the Sankhya number when absent and says nothing invented', () => {
    const out = renderOrderHtml(toOrderDocument({ ...source, erpNumber: null }));
    expect(out).not.toContain('Pedido Sankhya');
    expect(out).not.toContain('ERP');
  });

  it('escapes every interpolated value', () => {
    const hostile = '<script>alert(1)</script>"\'&';
    const out = renderOrderHtml(
      toOrderDocument({
        ...source,
        customerName: hostile,
        statusLabel: hostile,
        notes: hostile,
        items: [{ ...source.items[0]!, productDescription: hostile, unit: hostile }],
      }),
    );
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;');
  });

  it('accepts only safe logo sources', () => {
    const model = toOrderDocument(source);
    expect(renderOrderHtml(model, { logoSrc: 'data:image/png;base64,AAAA' })).toContain('<img');
    expect(renderOrderHtml(model, { logoSrc: 'https://app.example/brand/plac-logo.png' })).toContain('<img');
    const bad = renderOrderHtml(model, { logoSrc: 'javascript:alert(1)' });
    expect(bad).not.toContain('javascript:');
    expect(bad).not.toContain('<img');
    expect(renderOrderHtml(model, { logoSrc: 'https://x/"onerror="y' })).not.toContain('onerror');
  });
});

describe('restricted data never reaches the document (P-20)', () => {
  const tainted = {
    ...source,
    cost: '777.01',
    margin: '31.5',
    marginPercent: '15',
    unitCost: '5.55',
    sellerCode: 321,
    customerDocument: '12.345.678/0001-90',
    discountAuthority: 'blocked',
    approval: { decidedByName: 'Fulano Gerente', comment: 'segredo' },
    totals: { ...source.totals, totalCost: '999.99', margin: '12' },
    items: source.items.map((item) => ({ ...item, cost: '8.88', unitCost: '6.66', margin: '4.44', priceTableCode: 88 })),
  } as OrderDocumentSource;

  it('the mapper copies only the allowed fields', () => {
    const model = toOrderDocument(tainted);
    expect(Object.keys(model).sort()).toEqual(
      ['createdAt', 'customerCode', 'customerName', 'draftNumber', 'erpNumber', 'items', 'notes', 'statusLabel', 'totals'].sort(),
    );
    expect(Object.keys(model.totals).sort()).toEqual(['estimatedTotal', 'isPartial', 'unpricedLineCount']);
    for (const item of model.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['discountPercent', 'estimatedLineTotal', 'lineNo', 'productCode', 'productDescription', 'quantity', 'unit', 'unitListPrice'].sort(),
      );
    }
  });

  it('the rendered HTML never contains them', () => {
    const out = renderOrderHtml(toOrderDocument(tainted));
    for (const secret of ['777', '31.5', '31,5', '5,55', '8,88', '6,66', '4,44', '999,99', '12.345.678', 'Fulano', 'segredo', 'custo', 'margem']) {
      expect(out.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('the renderer ignores extra properties even when handed an unmapped object', () => {
    const out = renderOrderHtml(tainted as never);
    expect(out).not.toContain('777');
    expect(out).not.toContain('8,88');
    expect(out).not.toContain('Fulano');
  });
});
