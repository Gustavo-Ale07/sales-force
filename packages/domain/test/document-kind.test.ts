import { describe, expect, it } from 'vitest';
import { documentKindOf, documentVocabulary, type DocumentTopRules } from '../src/document-kind.js';

const rules: DocumentTopRules = { quoteTopCodes: [10, 11], quotationTopCode: 12 };

describe('documentKindOf (J3: the header TOP decides the vocabulary)', () => {
  it.each([
    ['a TOP in quoteTopCodes', 10, 'quote'],
    ['another TOP in quoteTopCodes', 11, 'quote'],
    ['the configured quotation TOP', 12, 'quote'],
    ['any other TOP', 99, 'order'],
    ['no TOP yet', null, 'order'],
  ])('%s', (_name, top, kind) => {
    expect(documentKindOf(top, rules)).toBe(kind);
  });

  it('works with no quote list configured', () => {
    expect(documentKindOf(10, { quoteTopCodes: undefined, quotationTopCode: null })).toBe('order');
  });
});

describe('documentVocabulary', () => {
  it('orders', () => {
    expect(documentVocabulary('order', 7)).toEqual({
      save: 'Salvar pedido',
      send: 'Enviar ao Sankhya',
      title: 'Pedido nº 7',
      heading: 'PEDIDO Nº 7',
      notSent: 'não enviado',
    });
  });

  it('quotes', () => {
    expect(documentVocabulary('quote', 7)).toEqual({
      save: 'Salvar orçamento',
      send: 'Enviar orçamento ao Sankhya',
      title: 'Orçamento nº 7',
      heading: 'ORÇAMENTO Nº 7',
      notSent: 'não enviado',
    });
  });

  it('without a number the title has no "nº"', () => {
    expect(documentVocabulary('order', null).title).toBe('Pedido');
    expect(documentVocabulary('quote', null).heading).toBe('ORÇAMENTO');
  });
});
