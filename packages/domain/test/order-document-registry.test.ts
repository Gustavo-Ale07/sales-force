import { describe, expect, it } from 'vitest';
import { customerRegistryLines, renderOrderHtml, resolveDocumentCarrier, toOrderDocument, type OrderDocumentSource } from '../src/index.js';

const lines = (r?: Parameters<typeof customerRegistryLines>[0]) => Object.fromEntries(customerRegistryLines(r).map((l) => [l.label, l.value]));

describe('customerRegistryLines', () => {
  it('shows a dash for every missing field, never null/undefined', () => {
    for (const registry of [undefined, {}, { street: null, city: '  ', email: 'null', mobile: 'undefined' }]) {
      const out = customerRegistryLines(registry);
      expect(out.map((l) => l.label)).toEqual(['CEP', 'Endereço', 'Bairro', 'Cidade', 'UF', 'Celular', 'E-mail']);
      for (const l of out) expect(l.value).toBe('—');
    }
  });

  it('formats CEP, street with number and complement, UF and phones', () => {
    const out = lines({ postalCode: '01310100', street: 'Avenida Paulista', number: '1578', complement: 'Conj. 12', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'sp', mobile: '11987654321', email: 'a@b.com.br' });
    expect(out).toEqual({
      CEP: '01310-100',
      Endereço: 'Avenida Paulista, nº 1578, Conj. 12',
      Bairro: 'Bela Vista',
      Cidade: 'São Paulo',
      UF: 'SP',
      Celular: '(11) 98765-4321',
      'E-mail': 'a@b.com.br',
    });
  });

  it('falls back to the landline, labelled Telefone, when there is no mobile', () => {
    const out = lines({ phone: '1133334444' });
    expect(out.Telefone).toBe('(11) 3333-4444');
    expect(out.Celular).toBeUndefined();
  });

  it('keeps a number only or a street without number', () => {
    expect(lines({ number: 'S/N' }).Endereço).toBe('—, nº S/N');
    expect(lines({ street: 'Rua Ação' }).Endereço).toBe('Rua Ação');
  });
});

describe('resolveDocumentCarrier', () => {
  it('prefers the order carrier, then the customer default, then null', () => {
    expect(resolveDocumentCarrier('Transp. A', 'Padrão')).toBe('Transp. A');
    expect(resolveDocumentCarrier(null, 'Padrão')).toBe('Padrão');
    expect(resolveDocumentCarrier('  ', undefined)).toBeNull();
  });
});

describe('order document blocks', () => {
  const base: OrderDocumentSource = {
    erpNumber: 1,
    customerCode: 9,
    customerName: 'Cliente',
    statusLabel: 'Não enviado',
    createdAt: '2026-03-31T12:00:00.000Z',
    notes: null,
    items: [],
    totals: { estimatedTotal: '0', isPartial: false, unpricedLineCount: 0 },
  };

  it('prints the carrier block and registry with dashes and escapes long accented text', () => {
    const long = `${'Rua Conceição '.repeat(30)}<b>`;
    const html = renderOrderHtml(
      toOrderDocument({ ...base, carrierName: null, customerRegistry: { street: long, email: `${'a'.repeat(120)}@ação.com` } }),
    );
    expect(html).toContain('<h2>Transportadora</h2><div><strong>—</strong>');
    expect(html).toContain('CEP: —');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('overflow-wrap: anywhere');
    expect(html).not.toMatch(/null|undefined/);
  });

  it('prints the carrier name', () => {
    expect(renderOrderHtml(toOrderDocument({ ...base, carrierName: 'Rápido Ltda' }))).toContain('<strong>Rápido Ltda</strong>');
  });
});
