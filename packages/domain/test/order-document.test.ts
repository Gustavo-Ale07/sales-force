import { describe, expect, it } from 'vitest';
import {
  documentIpiPercent,
  orderDocumentConditions,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  formatDocumentQuantity,
  renderOrderHtml,
  toOrderDocument,
  type OrderDocumentSource,
} from '../src/index.js';

const source: OrderDocumentSource = {
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
    expect(html).toContain('Pedido nº 987654');
    expect(html).toContain('<title>Pedido 987654</title>');
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
      ['createdAt', 'customerCode', 'customerName', 'erpNumber', 'items', 'notes', 'statusLabel', 'totals'].sort(),
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

describe('title without a number', () => {
  it('the internal Force number never appears, even if a caller passes one', () => {
    const withDraft = { ...source, erpNumber: null, draftNumber: 4242 } as OrderDocumentSource;
    for (const kind of ['order', 'quote'] as const) {
      const out = renderOrderHtml(toOrderDocument({ ...withDraft, kind }));
      expect(out).not.toContain('Force nº');
      expect(out).not.toContain('4242');
      expect(Object.keys(toOrderDocument(withDraft))).not.toContain('draftNumber');
    }
    expect(renderOrderHtml(toOrderDocument(source))).not.toContain('Force nº');
  });

  it('quote and order without Sankhya number print just the noun, never a placeholder', () => {
    const quote = renderOrderHtml(toOrderDocument({ ...source, erpNumber: null, kind: 'quote' }));
    const order = renderOrderHtml(toOrderDocument({ ...source, erpNumber: null, kind: 'order' }));
    expect(quote).not.toContain('sem número ainda');
    expect(order).not.toContain('sem número ainda');
    expect(quote).toContain('<title>Orçamento</title>');
    expect(order).toContain('<title>Pedido</title>');
  });

  it('with a Sankhya number the title carries it', () => {
    const quote = renderOrderHtml(toOrderDocument({ ...source, erpNumber: 42, kind: 'quote' }));
    expect(quote).toContain('<title>Orçamento 42</title>');
  });
});

describe('IPI and totals labels in the document (D-D)', () => {
  it('shows IPI and Total com IPI only when the source carries them, without the word estimado', () => {
    const plain = renderOrderHtml(toOrderDocument(source));
    expect(plain).not.toContain('IPI:');
    expect(plain).not.toContain('Total com IPI');
    expect(plain).toContain('<div class="total">Total: R$ 13.890,29</div>');
    expect(plain).not.toContain('estimado');
    for (const isPartial of [false, true]) {
      const html = renderOrderHtml(
        toOrderDocument({ ...source, ipi: { ipiEstimated: '1.60', grandTotalEstimated: '18.03', isPartial } }),
      );
      expect(html).toContain('<div class="total">IPI: R$ 1,60</div>');
      expect(html).toContain('<div class="total">Total com IPI: R$ 18,03</div>');
      expect(html).not.toContain('estimado');
      expect(html).not.toContain('calculado no Sankhya');
    }
  });
});

describe('D-W template (J4)', () => {
  const full = toOrderDocument({
    ...source,
    kind: 'quote',
    conditions: [
      { label: 'Condição de pagamento', value: '28 DDL' },
      { label: 'Tipo de negociação', value: 'Boleto' },
    ],
    items: [{ ...source.items[0]!, ipiPercent: '5' }, source.items[1]!],
    ipi: { ipiEstimated: '1.60', grandTotalEstimated: '18.03', isPartial: true },
  });
  const options = { issuedAt: '2026-11-04T17:05:00.000Z', sellerName: 'Maria Vendedora', brandName: 'PLAC' };

  it('A4, 15 mm margins, 10.5 pt, page X of Y, repeated header, brand colours', () => {
    const html = renderOrderHtml(full, options);
    expect(html).toContain('size: A4');
    expect(html).toContain('margin: 15mm');
    expect(html).toContain('10.5pt');
    expect(html).toContain('página');
    expect(html).toContain('counter(page)');
    expect(html).toContain('counter(pages)');
    expect(html).toContain('display: table-header-group');
    expect(html).toContain('#01136A');
    expect(html).toContain('#FF0109');
  });

  it('header follows the TOP kind and state', () => {
    const quote = renderOrderHtml(full, options);
    expect(quote).toContain('ORÇAMENTO');
    expect(quote).not.toContain('PEDIDO FORCE');
    const order = renderOrderHtml(toOrderDocument({ ...source, kind: 'order' }), options);
    expect(order).toContain('PEDIDO');
    expect(order).not.toContain('ORÇAMENTO');
    expect(quote).toContain('Enviado ao Sankhya');
  });

  it('shows CLIENTE and CONDIÇÕES side by side, IPI % per item and the IPI note', () => {
    const html = renderOrderHtml(full, options);
    expect(html).toContain('Cliente');
    expect(html).toContain('Condições');
    expect(html).toContain('28 DDL');
    expect(html).toContain('IPI %');
    expect(html).toContain('5%');
    expect(html).toContain('IPI: R$');
    expect(html).not.toContain('estimado');
    expect(html).toContain('Observações');
  });

  it('an item without IPI percentage shows a dash, never zero', () => {
    const html = renderOrderHtml(toOrderDocument({ ...source, kind: 'order', items: source.items }), options);
    expect(html).toContain('<td class="n">—</td>');
  });

  it('footer carries the issue moment (business time) and the seller', () => {
    const html = renderOrderHtml(full, options);
    expect(html).toContain('Emitido pelo Sales Force em 04/11/2026 14:05 · Maria Vendedora');
  });

  it('company block only from supplied data; absent means omitted, nothing invented', () => {
    const without = renderOrderHtml(full, options);
    expect(without).not.toContain('CNPJ');
    expect(without).not.toContain('class="company"');
    const withCompany = renderOrderHtml(full, { ...options, company: { legalName: 'Empresa Exemplo Ltda', cnpj: '00.000.000/0001-00' } });
    expect(withCompany).toContain('Empresa Exemplo Ltda');
    expect(withCompany).toContain('CNPJ 00.000.000/0001-00');
    expect(withCompany).not.toContain('Telefone');
    const empty = renderOrderHtml(full, { ...options, company: {} });
    expect(empty).not.toContain('class="company"');
  });

  it('never carries restricted fields and matches the layout snapshot', () => {
    const html = renderOrderHtml(full, options);
    for (const word of ['custo', 'margem', 'crédito', 'financeiro']) expect(html.toLowerCase()).not.toContain(word);
    expect(html.replace(/<style>[\s\S]*?<\/style>/, '<style/>')).toMatchSnapshot();
  });
});

describe('IPI percent and conditions of the document', () => {
  it('shows the line IPI rate only when it is known, a dash otherwise', () => {
    expect(documentIpiPercent({ status: 'estimated', percentual: '5.5' })).toBe('5.5');
    expect(documentIpiPercent({ status: 'rate', percentual: '10' })).toBe('10');
    for (const status of ['exempt', 'tariff', 'unavailable']) expect(documentIpiPercent({ status })).toBeNull();
    expect(documentIpiPercent(undefined)).toBeNull();
    const html = renderOrderHtml(
      toOrderDocument({ ...source, items: [{ ...source.items[0]!, ipiPercent: '5.5' }, { ...source.items[1]!, ipiPercent: documentIpiPercent({ status: 'tariff' }) }] }),
      {},
    );
    expect(html).toContain('<th class="n">IPI %</th>');
    expect(html).toContain('5,5%');
  });

  it('lists the negotiation type by label, then freight, in the Condições box', () => {
    const conditions = orderDocumentConditions({ negotiationTypeCode: 4, negotiationTypes: [{ code: 4, label: 'À vista' }], freightLabel: 'CIF' });
    expect(conditions).toEqual([
      { label: 'Tipo de negociação', value: 'À vista' },
      { label: 'Frete', value: 'CIF' },
    ]);
    const html = renderOrderHtml(toOrderDocument({ ...source, conditions }), {});
    expect(html).toContain('Condições');
    expect(html).toContain('Tipo de negociação: <strong>À vista</strong>');
  });

  it('falls back to the code when the label is unknown and omits what is absent', () => {
    expect(orderDocumentConditions({ negotiationTypeCode: 9 })).toEqual([{ label: 'Tipo de negociação', value: 'Código 9' }]);
    expect(orderDocumentConditions({ negotiationTypeCode: null })).toEqual([]);
  });
});
