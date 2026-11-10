import { describe, expect, it } from 'vitest';
import { FakeGateway, FakeOrderBook, SankhyaGatewayError, buildConfirmarNotaBody, maskConfirmResponse, parseConfirmarNotaResponse } from '../src/index.js';

/** confirmarNota is NEEDS VALIDATION: these tests pin the DEFENSIVE reading, not a validated ERP format. */
const ok = (body: unknown) => parseConfirmarNotaResponse(200, JSON.stringify(body));

describe('parseConfirmarNotaResponse (defensive, NEEDS VALIDATION)', () => {
  it('status 1 is a confirmation', () => {
    expect(ok({ status: '1', responseBody: {} }).outcome).toBe('confirmed');
  });

  it('status 1 with generated releases is a pending release, not an error', () => {
    expect(ok({ status: '1', responseBody: { liberacoes: { liberacao: [{ EVENTO: { $: '9' } }] } } }).outcome).toBe('release_pending');
  });

  it('"already confirmed" is a success (idempotent)', () => {
    expect(ok({ status: '0', statusMessage: 'A nota já está confirmada.' }).outcome).toBe('already_confirmed');
  });

  it('a refusal that mentions a release is a pending release, not an error', () => {
    expect(ok({ status: '0', statusMessage: 'Nota aguardando liberação do gestor.' }).outcome).toBe('release_pending');
  });

  it('any other refusal is a validation error carrying the readable reason', () => {
    expect.assertions(3);
    try {
      ok({ status: '0', statusMessage: 'Estoque insuficiente para o produto 55.' });
    } catch (error) {
      expect(error).toBeInstanceOf(SankhyaGatewayError);
      expect((error as SankhyaGatewayError).kind).toBe('validation');
      expect((error as SankhyaGatewayError).message).toContain('Estoque insuficiente');
    }
  });

  it('classifies HTTP and parse failures like every other call', () => {
    expect(() => parseConfirmarNotaResponse(503, '')).toThrowError(expect.objectContaining({ kind: 'unavailable' }) as Error);
    expect(() => parseConfirmarNotaResponse(200, 'not json')).toThrowError(expect.objectContaining({ kind: 'temporary' }) as Error);
  });

  it('keeps the masked response: sensitive keys hidden, long text truncated', () => {
    const masked = maskConfirmResponse(JSON.stringify({ status: '1', token: 'abc', responseBody: { note: 'x'.repeat(5000) } }));
    expect(masked).not.toContain('abc');
    expect(masked).toContain('[masked]');
    expect(masked.length).toBeLessThanOrEqual(1501);
  });

  it('builds the body from the NUNOTA only and rejects an invalid number', () => {
    expect(buildConfirmarNotaBody(2475)).toEqual({ nota: { NUNOTA: { $: '2475' } } });
    expect(() => buildConfirmarNotaBody(0)).toThrow();
  });
});

describe('fake order book confirmation scenarios', () => {
  const originRequest = {
    originField: 'AD_ORIGEM',
    originId: '0198f1d2-0000-7000-8000-000000000001',
    companyCode: 1,
    partnerCode: 10,
    topCode: 1001,
    negotiationTypeCode: 11,
    sellerCode: 1,
    orderDate: '2026-11-10',
    items: [{ productCode: 55, quantity: '1', unit: 'UN', discountPercent: null, listUnitPrice: '10' }],
  } as never;

  async function included(book: FakeOrderBook) {
    const gateway = new FakeGateway({ orders: book });
    const { erpOrderNumber } = await gateway.includeOrder(originRequest);
    return { gateway, erpOrderNumber };
  }

  it('pending release: not an error, the note stays unconfirmed, and a later confirmation succeeds', async () => {
    const book = new FakeOrderBook();
    const { gateway, erpOrderNumber } = await included(book);
    book.script('confirm', { kind: 'release_pending' });
    expect((await gateway.confirmOrder(erpOrderNumber)).outcome).toBe('release_pending');
    expect(book.orders[0]?.confirmed).toBe(false);
    expect((await gateway.confirmOrder(erpOrderNumber)).outcome).toBe('confirmed');
  });

  it('insufficient stock: a validation refusal, the note stays included (never re-included)', async () => {
    const book = new FakeOrderBook();
    const { gateway, erpOrderNumber } = await included(book);
    book.script('confirm', { kind: 'error', error: new SankhyaGatewayError('validation', { code: 'erp_refused_confirmation', message: 'Estoque insuficiente.' }) });
    await expect(gateway.confirmOrder(erpOrderNumber)).rejects.toMatchObject({ kind: 'validation' });
    expect(book.orders).toHaveLength(1);
    expect(book.count('include')).toBe(1);
  });

  it('timeout after the ERP confirmed: the repetition reports already confirmed', async () => {
    const book = new FakeOrderBook();
    const { gateway, erpOrderNumber } = await included(book);
    book.script('confirm', { kind: 'created_then_error', error: new SankhyaGatewayError('temporary', { code: 'timeout', message: 'timeout' }) });
    await expect(gateway.confirmOrder(erpOrderNumber)).rejects.toMatchObject({ code: 'timeout' });
    expect((await gateway.confirmOrder(erpOrderNumber)).outcome).toBe('already_confirmed');
  });
});
