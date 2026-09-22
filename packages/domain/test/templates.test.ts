import { describe, expect, it } from 'vitest';
import {
  MAX_TEMPLATES_PER_CUSTOMER,
  MAX_TEMPLATE_ITEMS,
  canAddTemplate,
  normalizeTemplateItems,
  normalizeTemplateName,
  presentSkips,
  selectUsableTemplateLines,
  type InstallationConfiguration,
  type Product,
  type ResolvedPrice,
  type TemplateLineSkip,
} from '../src/index.js';
import { makeConfig, makeProduct } from './fixtures.js';

const priced: ResolvedPrice = { state: 'priced', unitPrice: '10', tableCode: 88, versionId: 4 };
const zero: ResolvedPrice = { state: 'zero', unitPrice: '0', tableCode: 88, versionId: 4 };
const none: ResolvedPrice = { state: 'none', reason: 'no_price_row', tableCode: 88, versionId: 4 };

describe('normalizeTemplateName', () => {
  it('trims and keeps the case', () => {
    expect(normalizeTemplateName('  Reposição Mensal  ')).toEqual({ ok: true, value: 'Reposição Mensal' });
  });

  it('rejects empty, blank, over-long and control-character names', () => {
    expect(normalizeTemplateName('')).toEqual({ ok: false, error: 'name_empty' });
    expect(normalizeTemplateName('   ')).toEqual({ ok: false, error: 'name_empty' });
    expect(normalizeTemplateName('a'.repeat(81))).toEqual({ ok: false, error: 'name_too_long' });
    expect(normalizeTemplateName('a'.repeat(80)).ok).toBe(true);
    expect(normalizeTemplateName('a\nb')).toEqual({ ok: false, error: 'name_control_characters' });
    expect(normalizeTemplateName('a\u0000b')).toEqual({ ok: false, error: 'name_control_characters' });
    expect(normalizeTemplateName('a\u007fb')).toEqual({ ok: false, error: 'name_control_characters' });
  });

  it('counts code points like the database, not UTF-16 units', () => {
    expect(normalizeTemplateName('😀'.repeat(80)).ok).toBe(true);
    expect(normalizeTemplateName('😀'.repeat(81))).toEqual({ ok: false, error: 'name_too_long' });
  });
});

describe('normalizeTemplateItems', () => {
  it('canonicalizes quantities and keeps the order of the lines', () => {
    const result = normalizeTemplateItems([
      { productCode: 7, quantity: '2.5000' },
      { productCode: 3, quantity: '10' },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { productCode: 7, quantity: '2.5' },
        { productCode: 3, quantity: '10' },
      ],
    });
  });

  it('reports every problem with a stable code and the position of the line', () => {
    const result = normalizeTemplateItems([
      { productCode: 1, quantity: '0' },
      { productCode: 2, quantity: '1.23456' },
      { productCode: 1, quantity: '3' },
      { productCode: 4, quantity: 'abc' },
    ]);
    expect(result).toEqual({
      ok: false,
      error: [
        { code: 'invalid_quantity', path: 'items[0].quantity' },
        { code: 'invalid_quantity', path: 'items[1].quantity' },
        { code: 'duplicate_product', path: 'items[2].productCode' },
        { code: 'invalid_quantity', path: 'items[3].quantity' },
      ],
    });
  });

  it('requires 1 to 500 lines', () => {
    expect(normalizeTemplateItems([])).toEqual({ ok: false, error: [{ code: 'no_items', path: 'items' }] });
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ productCode: i + 1, quantity: '1' }));
    expect(normalizeTemplateItems(many(MAX_TEMPLATE_ITEMS)).ok).toBe(true);
    expect(normalizeTemplateItems(many(MAX_TEMPLATE_ITEMS + 1))).toEqual({
      ok: false,
      error: [{ code: 'too_many_items', path: 'items' }],
    });
  });

  it('rejects a product code that cannot be a code', () => {
    expect(normalizeTemplateItems([{ productCode: -1, quantity: '1' }])).toEqual({
      ok: false,
      error: [{ code: 'invalid_product_code', path: 'items[0].productCode' }],
    });
    expect(normalizeTemplateItems([{ productCode: 1.5, quantity: '1' }]).ok).toBe(false);
  });
});

describe('canAddTemplate', () => {
  it('allows up to the limit of live templates per customer', () => {
    expect(canAddTemplate(0)).toBe(true);
    expect(canAddTemplate(MAX_TEMPLATES_PER_CUSTOMER - 1)).toBe(true);
    expect(canAddTemplate(MAX_TEMPLATES_PER_CUSTOMER)).toBe(false);
  });
});

describe('selectUsableTemplateLines', () => {
  const config = makeConfig();
  const lines = (codes: number[]) => codes.map((productCode, index) => ({ lineNo: index + 1, productCode, quantity: '1' }));
  const products = (list: Product[]) => new Map(list.map((p) => [p.code, p]));
  const prices = (entries: [number, ResolvedPrice][]) => new Map(entries);

  it('keeps sellable priced products, in template order', () => {
    const result = selectUsableTemplateLines(
      lines([1, 2]),
      products([makeProduct({ code: 1 }), makeProduct({ code: 2 })]),
      prices([[1, priced], [2, priced]]),
      config,
    );
    expect(result.usable.map((l) => l.productCode)).toEqual([1, 2]);
    expect(result.skipped).toEqual([]);
  });

  it('skips and explains each line that cannot be ordered now, never pricing it by guess', () => {
    const list = products([
      makeProduct({ code: 2, active: false }),
      makeProduct({ code: 3, usageCode: 'ZZ' }),
      makeProduct({ code: 4 }),
      makeProduct({ code: 5 }),
    ]);
    const result = selectUsableTemplateLines(
      lines([1, 2, 3, 4, 5]),
      list,
      prices([[2, priced], [3, priced], [4, none], [5, zero]]),
      config,
    );
    expect(result.usable).toEqual([]);
    expect(result.skipped).toEqual([
      { lineNo: 1, productCode: 1, reason: 'product_removed' },
      { lineNo: 2, productCode: 2, reason: 'product_inactive' },
      { lineNo: 3, productCode: 3, reason: 'product_not_sellable' },
      { lineNo: 4, productCode: 4, reason: 'no_price' },
      { lineNo: 5, productCode: 5, reason: 'zero_price' },
    ]);
  });

  it('a line without a usable price is usable only when the installation allows ordering it', () => {
    const permissive: InstallationConfiguration = {
      ...config,
      sales: { ...config.sales, orderBehavior: { allowDraftWithoutPrice: true } },
      products: { ...config.products, productWithoutPrice: { visible: true, orderable: true } },
    };
    const result = selectUsableTemplateLines(lines([4]), products([makeProduct({ code: 4 })]), prices([[4, none]]), permissive);
    expect(result.usable.map((l) => l.productCode)).toEqual([4]);
  });

  it('a product the configuration hides from the catalog is skipped as hidden, even when it could be ordered', () => {
    const hidden: InstallationConfiguration = {
      ...config,
      sales: { ...config.sales, orderBehavior: { allowDraftWithoutPrice: true } },
      products: { ...config.products, productWithoutPrice: { visible: false, orderable: true } },
    };
    const result = selectUsableTemplateLines(lines([4]), products([makeProduct({ code: 4 })]), prices([[4, none]]), hidden);
    expect(result.skipped).toEqual([{ lineNo: 1, productCode: 4, reason: 'product_hidden' }]);
  });

  it('a product with no price entry at all is "no_price", not a crash', () => {
    const result = selectUsableTemplateLines(lines([1]), products([makeProduct({ code: 1 })]), prices([]), config);
    expect(result.skipped).toEqual([{ lineNo: 1, productCode: 1, reason: 'no_price' }]);
  });

  it('nothing is sellable when the installation is not enabled', () => {
    const off: InstallationConfiguration = { ...config, general: { ...config.general, enabled: false } };
    const result = selectUsableTemplateLines(lines([1]), products([makeProduct({ code: 1 })]), prices([[1, priced]]), off);
    expect(result.usable).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('product_not_sellable');
  });
});

describe('presentSkips', () => {
  const skipped: TemplateLineSkip[] = [
    { lineNo: 1, productCode: 1, reason: 'product_hidden' },
    { lineNo: 2, productCode: 2, reason: 'product_not_sellable' },
    { lineNo: 3, productCode: 3, reason: 'product_removed' },
    { lineNo: 4, productCode: 4, reason: 'product_inactive' },
    { lineNo: 5, productCode: 5, reason: 'no_price' },
    { lineNo: 6, productCode: 6, reason: 'zero_price' },
  ];

  it('masks product_hidden and product_not_sellable as product_removed for non-admin roles (P-21)', () => {
    for (const role of ['seller', 'manager'] as const) {
      expect(presentSkips(role, skipped)).toEqual([
        { lineNo: 1, productCode: 1, reason: 'product_removed' },
        { lineNo: 2, productCode: 2, reason: 'product_removed' },
        { lineNo: 3, productCode: 3, reason: 'product_removed' },
        { lineNo: 4, productCode: 4, reason: 'product_inactive' },
        { lineNo: 5, productCode: 5, reason: 'no_price' },
        { lineNo: 6, productCode: 6, reason: 'zero_price' },
      ]);
    }
  });

  it('leaves every reason as-is for the admin role: no masking, no probing concern', () => {
    expect(presentSkips('admin', skipped)).toEqual(skipped);
  });

  it('never mutates the input array or its entries', () => {
    const input: TemplateLineSkip[] = [{ lineNo: 1, productCode: 1, reason: 'product_hidden' }];
    const copy = input.map((line) => ({ ...line }));
    presentSkips('seller', input);
    expect(input).toEqual(copy);
  });
});
