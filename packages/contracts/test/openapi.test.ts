import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { generate } from '../scripts/generate-openapi.js';
import { buildOpenApiDocument, routeList, serializeOpenApi } from '../src/index.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (relative: string): string =>
  readFileSync(resolve(root, relative), 'utf8').replace(/\r\n/g, '\n');

type Doc = ReturnType<typeof buildOpenApiDocument>;

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') out.push(value);
      else collectRefs(value, out);
    }
  }
  return out;
}

describe('OpenAPI generation', () => {
  const doc: Doc = buildOpenApiDocument();

  it('is deterministic', () => {
    expect(serializeOpenApi(buildOpenApiDocument())).toBe(serializeOpenApi(buildOpenApiDocument()));
  });

  it('the committed document and client types are current', async () => {
    const { openapi, types } = await generate();
    expect(read('openapi/openapi.json')).toBe(openapi);
    expect(read('src/generated/api-types.ts')).toBe(types);
  });

  it('is a valid OpenAPI 3.1 document', async () => {
    const result = await new Validator().validate(JSON.parse(serializeOpenApi(doc)));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(doc['openapi']).toBe('3.1.0');
  });

  it('documents every registry route exactly once with its operation id', () => {
    const paths = doc['paths'] as Record<string, Record<string, { operationId: string }>>;
    const documented = Object.values(paths).flatMap((item) =>
      Object.values(item).map((o) => o.operationId),
    );
    expect(documented.sort()).toEqual(routeList.map((r) => r.operationId).sort());
    for (const route of routeList) {
      expect(paths[route.path]?.[route.method]?.operationId).toBe(route.operationId);
    }
  });

  it('has no dangling references', () => {
    const schemas = (doc['components'] as { schemas: Record<string, unknown> }).schemas;
    for (const ref of collectRefs(doc)) {
      expect(ref.startsWith('#/components/schemas/')).toBe(true);
      expect(schemas).toHaveProperty(ref.replace('#/components/schemas/', ''));
    }
  });

  it('public routes opt out of the session security requirement; session routes inherit it', () => {
    const paths = doc['paths'] as Record<
      string,
      Record<string, { operationId: string; security?: unknown[] }>
    >;
    for (const route of routeList) {
      const op = paths[route.path]?.[route.method];
      if (route.auth === 'public') expect(op?.security).toEqual([]);
      else expect(op?.security).toBeUndefined();
    }
    expect(doc['security']).toEqual([{ sessionCookie: [] }]);
  });

  it('every operation answers with the error envelope for its declared error statuses', () => {
    const paths = doc['paths'] as Record<
      string,
      Record<
        string,
        {
          responses: Record<
            string,
            { content?: { 'application/json': { schema: { $ref?: string } } } }
          >;
        }
      >
    >;
    for (const route of routeList) {
      const op = paths[route.path]?.[route.method];
      for (const status of route.errors) {
        if (route.responses[status]) continue;
        expect(op?.responses[String(status)]?.content?.['application/json'].schema.$ref).toBe(
          '#/components/schemas/ApiError',
        );
      }
    }
  });

  it('models the order create/replace bodies without any price field', () => {
    const schemas = (
      doc['components'] as { schemas: Record<string, { properties: Record<string, unknown> }> }
    ).schemas;
    expect(Object.keys(schemas['OrderItemInput']?.properties ?? {}).sort()).toEqual([
      'productCode',
      'quantity',
    ]);
    expect(Object.keys(schemas['CreateOrderRequest']?.properties ?? {}).sort()).toEqual([
      'clientRequestId',
      'customerCode',
      'items',
      'negotiationTypeCode',
      'notes',
    ]);
  });
});
