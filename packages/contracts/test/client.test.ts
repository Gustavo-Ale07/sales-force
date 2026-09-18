import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client.js';
import { UUID_A } from './fixtures.js';

interface Recorded {
  method: string;
  url: string;
  body: string;
}

function makeClient() {
  const calls: Recorded[] = [];
  const client = createApiClient('http://localhost/api/v1', {
    fetch: async (request: Request) => {
      calls.push({ method: request.method, url: request.url, body: await request.text() });
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, calls };
}

describe('generated typed client', () => {
  it('builds URLs from the generated paths, with typed query and path parameters', async () => {
    const { client, calls } = makeClient();
    await client.GET('/customers', {
      params: { query: { page: 2, hasPriceTable: 'true', sort: '-name' } },
    });
    await client.GET('/customers/{code}', { params: { path: { code: 5001 } } });
    await client.GET('/health');
    expect(
      calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`),
    ).toEqual([
      'GET /api/v1/customers?page=2&hasPriceTable=true&sort=-name',
      'GET /api/v1/customers/5001',
      'GET /api/v1/health',
    ]);
  });

  it('sends typed JSON bodies', async () => {
    const { client, calls } = makeClient();
    await client.POST('/orders', {
      body: {
        clientRequestId: UUID_A,
        customerCode: 5001,
        negotiationTypeCode: null,
        notes: null,
        items: [{ productCode: 3001, quantity: '2' }],
      },
    });
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      items: [{ productCode: 3001, quantity: '2' }],
    });
  });

  it('rejects unknown query parameters and unknown paths at compile time', async () => {
    const { client } = makeClient();
    // @ts-expect-error unknown query parameter
    await client.GET('/customers', { params: { query: { cost: 1 } } });
    // @ts-expect-error path is not part of the API
    await client.GET('/not-an-endpoint');
  });

  it('uses the injected fetch implementation', async () => {
    const { client, calls } = makeClient();
    await client.GET('/ready');
    expect(calls).toHaveLength(1);
  });
});
