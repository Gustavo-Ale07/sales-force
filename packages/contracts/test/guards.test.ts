import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument, routeList } from '../src/index.js';

/**
 * P-20 / P-22 guard: no contract may carry cost, margin, secret, token or password fields. The single
 * allowed exception is the `password` property of the login request (request-only credential).
 */
// "custo(?!mer)": the Portuguese word for cost, without matching "customer".
const FORBIDDEN = /cost|margin|custo(?!mer)|margem|secret|token|password/i;

interface Finding {
  location: string;
  key: string;
}

/** Walks any JSON value and reports every object key or component/operation/parameter name that matches. */
export function findForbiddenKeys(node: unknown, location = '#', found: Finding[] = []): Finding[] {
  if (Array.isArray(node)) {
    node.forEach((item, index) => findForbiddenKeys(item, `${location}/${index}`, found));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN.test(key)) found.push({ location, key });
      findForbiddenKeys(value, `${location}/${key}`, found);
      // parameter / operation names are values, not keys
      if (
        (key === 'name' || key === 'operationId') &&
        typeof value === 'string' &&
        FORBIDDEN.test(value)
      ) {
        found.push({ location: `${location}/${key}`, key: value });
      }
    }
  }
  return found;
}

const ALLOWED = [{ location: '#/components/schemas/LoginRequest/properties', key: 'password' }];

describe('sensitive-field guard (P-20, P-22)', () => {
  const doc = buildOpenApiDocument();

  it('detects forbidden keys (the guard itself works)', () => {
    expect(findForbiddenKeys({ properties: { unitCost: {} } })).toHaveLength(1);
    expect(
      findForbiddenKeys({ properties: { Margem: {}, apiSecret: {}, sessionToken: {} } }),
    ).toHaveLength(3);
    expect(findForbiddenKeys({ parameters: [{ name: 'custoMedio' }] })).toHaveLength(1);
    expect(findForbiddenKeys({ properties: { price: {}, total: {} } })).toHaveLength(0);
  });

  it('the generated OpenAPI document has no such key except the login password', () => {
    expect(findForbiddenKeys(doc)).toEqual(ALLOWED);
  });

  it('the password exists only in the login request', () => {
    const paths = JSON.stringify(doc['paths']);
    expect(paths).not.toMatch(/password/i);
    const schemas = doc['components'] as { schemas: Record<string, unknown> };
    for (const [id, schema] of Object.entries(schemas.schemas)) {
      if (id === 'LoginRequest') continue;
      expect(JSON.stringify(schema)).not.toMatch(/password/i);
    }
  });

  it('no registry route or component id carries a forbidden name', () => {
    for (const route of routeList) {
      expect(route.operationId).not.toMatch(FORBIDDEN);
      expect(route.path).not.toMatch(FORBIDDEN);
    }
    const schemas = (doc['components'] as { schemas: Record<string, unknown> }).schemas;
    for (const id of Object.keys(schemas)) expect(id).not.toMatch(FORBIDDEN);
  });

  it('the session security scheme names a cookie, never a bearer token or key value', () => {
    const scheme = (
      doc['components'] as { securitySchemes: Record<string, { type: string; in: string }> }
    ).securitySchemes['sessionCookie'];
    expect(scheme).toMatchObject({ type: 'apiKey', in: 'cookie' });
  });
});
