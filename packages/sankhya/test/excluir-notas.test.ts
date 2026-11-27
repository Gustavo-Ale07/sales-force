import { describe, expect, it } from 'vitest';
import { FakeGateway, FakeOrderBook, SankhyaGatewayError, buildExcluirNotasBody, buildExcluirNotasRequestText, parseExcluirNotasResponse } from '../src/index.js';

/** excluirNotas: wire VALIDATED in the Sandbox for an unconfirmed order (F-51); the refusal text is read defensively. */
describe('excluirNotas wire (F-51)', () => {
  it('builds the validated body: NUNOTA as a plain string inside notas.nota[]', () => {
    expect(buildExcluirNotasBody(2475)).toEqual({ notas: { nota: [{ NUNOTA: '2475' }] } });
    expect(JSON.parse(buildExcluirNotasRequestText(2475))).toEqual({ serviceName: 'CACSP.excluirNotas', requestBody: { notas: { nota: [{ NUNOTA: '2475' }] } } });
    expect(() => buildExcluirNotasBody(0)).toThrow();
    expect(() => buildExcluirNotasBody(1.5)).toThrow();
  });

  it('status 1 with an empty body is a deletion', () => {
    expect(parseExcluirNotasResponse(200, JSON.stringify({ status: '1', responseBody: '' })).maskedResponse).toContain('"status":"1"');
  });

  it('any other status is a permanent validation error with the readable reason', () => {
    expect.assertions(3);
    try {
      parseExcluirNotasResponse(200, JSON.stringify({ status: '0', statusMessage: 'Nota confirmada nao pode ser excluida.' }));
    } catch (error) {
      expect(error).toBeInstanceOf(SankhyaGatewayError);
      expect((error as SankhyaGatewayError).kind).toBe('validation');
      expect((error as SankhyaGatewayError).code).toBe('erp_refused_delete');
    }
  });

  it('classifies HTTP and parse failures like every other call', () => {
    expect(() => parseExcluirNotasResponse(503, '')).toThrowError(expect.objectContaining({ kind: 'unavailable' }) as Error);
    expect(() => parseExcluirNotasResponse(200, 'not json')).toThrowError(expect.objectContaining({ kind: 'temporary' }) as Error);
  });
});

describe('fake order book: delete and edit facts', () => {
  const request = {
    originField: 'AD_FORCEORIGEM',
    originId: '0198f1d2-0000-7000-8000-000000000001',
    companyCode: 1,
    customerCode: 10,
    topCode: 1001,
    negotiationTypeCode: 11,
    sellerCode: 1,
    orderDate: '2026-11-27',
    items: [{ productCode: 55, quantity: '1', unit: 'UN', discountPercent: null, listUnitPrice: '10' }],
  } as never;

  it('deleting an unconfirmed order removes it, so the origin lookup no longer finds it', async () => {
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    const { erpOrderNumber } = await gateway.includeOrder(request);
    await gateway.deleteOrder(erpOrderNumber);
    expect(await gateway.findOrderByOrigin('AD_FORCEORIGEM', '0198f1d2-0000-7000-8000-000000000001')).toBeNull();
    expect(book.count('delete')).toBe(1);
  });

  it('refuses to delete a confirmed or missing note (validation)', async () => {
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    const { erpOrderNumber } = await gateway.includeOrder(request);
    await gateway.confirmOrder(erpOrderNumber);
    await expect(gateway.deleteOrder(erpOrderNumber)).rejects.toMatchObject({ kind: 'validation', code: 'erp_refused_delete' });
    await expect(gateway.deleteOrder(999_999)).rejects.toMatchObject({ kind: 'validation' });
    expect(book.orders).toHaveLength(1);
  });

  it('created_then_error deletes the note but the caller sees a failure (resumable case)', async () => {
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    const { erpOrderNumber } = await gateway.includeOrder(request);
    book.script('delete', { kind: 'created_then_error', error: new SankhyaGatewayError('temporary', { code: 'timeout', message: 'timeout' }) });
    await expect(gateway.deleteOrder(erpOrderNumber)).rejects.toMatchObject({ kind: 'temporary' });
    expect(book.orders).toHaveLength(0);
  });

  it('edit facts: untouched, confirmed, definitive financial and missing notes', async () => {
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    const first = (await gateway.includeOrder(request)).erpOrderNumber;
    const second = (await gateway.includeOrder({ ...(request as object), originId: 'other' } as never)).erpOrderNumber;
    await gateway.confirmOrder(second);
    book.definitiveFinancial.add(first);
    const [a, b, c] = await gateway.readOrderEditFacts([first, second, 999_999]);
    expect(a).toMatchObject({ found: true, statusNota: 'A', hasDefinitiveFinancial: true, hasReleaseLines: false });
    expect(b).toMatchObject({ found: true, statusNota: 'L', hasDefinitiveFinancial: false });
    expect(c).toMatchObject({ found: false });
  });
});
