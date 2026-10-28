import { describe, expect, it } from 'vitest';
import openapi from '../openapi/openapi.json' with { type: 'json' };

// P-20: cost, margin and commission never reach a client. The server integration test asserts the live
// responses; this one asserts the published contract of every /products* operation cannot even describe them.
const RESTRICTED = /cost|margin|margem|commission|comiss|custo(?!m)/i;

type Node = Record<string, unknown>;
const doc = openapi as unknown as { paths: Record<string, Node>; components: { schemas: Record<string, unknown> } };

function reachablePropertyNames(root: unknown, seen = new Set<string>(), names: string[] = []): string[] {
  if (Array.isArray(root)) {
    for (const entry of root) reachablePropertyNames(entry, seen, names);
  } else if (typeof root === 'object' && root !== null) {
    for (const [key, value] of Object.entries(root)) {
      if (key === '$ref' && typeof value === 'string') {
        const name = value.replace('#/components/schemas/', '');
        if (!seen.has(name)) {
          seen.add(name);
          reachablePropertyNames(doc.components.schemas[name], seen, names);
        }
      } else if (key === 'properties' && typeof value === 'object' && value !== null) {
        names.push(...Object.keys(value));
        reachablePropertyNames(value, seen, names);
      } else {
        reachablePropertyNames(value, seen, names);
      }
    }
  }
  return names;
}

const productPaths = Object.keys(doc.paths).filter((p) => p.startsWith('/products') || p.startsWith('/product-'));

describe('/products* contract exposes no restricted data (P-20)', () => {
  it('covers list, detail, image, groups and resolutions', () => {
    expect(productPaths.sort()).toEqual(['/product-groups', '/product-resolutions', '/products', '/products/{code}', '/products/{code}/image']);
  });

  it.each(productPaths)('%s has no cost, margin or commission property in any request or response schema', (path) => {
    const names = reachablePropertyNames(doc.paths[path]);
    expect(names.length, 'the walk must reach real properties').toBeGreaterThan(0);
    expect(names.filter((name) => RESTRICTED.test(name))).toEqual([]);
  });

  it('the walk would catch a planted restricted property', () => {
    const planted = { schema: { type: 'object', properties: { unitCost: { type: 'string' } } } };
    expect(reachablePropertyNames(planted).filter((name) => RESTRICTED.test(name))).toEqual(['unitCost']);
  });
});
