import { describe, expect, it } from 'vitest';
import { subtreeOf, visibleGroups, type GroupRow } from '../../src/mirror/product-groups.js';

const g = (code: number, name: string, parentCode: number | null, degree: number, active = true): GroupRow => ({
  code,
  name,
  parentCode,
  degree,
  active,
});

// 3 levels: 10 Tubos > 11 Aço > 111 Aço 1", 112 Aço 2"; 10 > 12 PVC (final at level 2); 20 Serviços (final at level 1).
const tree: GroupRow[] = [
  g(10, 'Tubos', null, 1),
  g(11, 'Aço', 10, 2),
  g(111, 'Aço 1"', 11, 3),
  g(112, 'Aço 2"', 11, 3),
  g(12, 'PVC', 10, 2),
  g(20, 'Serviços', null, 1),
];

const byCode = (nodes: ReturnType<typeof visibleGroups>) => new Map(nodes.map((n) => [n.code, n] as const));

describe('visibleGroups', () => {
  it('builds the 3-level cascade; finals at level 1, 2 and 3 have no children', () => {
    const nodes = byCode(visibleGroups(tree, new Set([111, 112, 12, 20])));
    expect(nodes.get(10)).toMatchObject({ parentCode: null, hasChildren: true });
    expect(nodes.get(11)).toMatchObject({ parentCode: 10, hasChildren: true });
    expect(nodes.get(111)).toMatchObject({ parentCode: 11, hasChildren: false });
    expect(nodes.get(12)).toMatchObject({ parentCode: 10, hasChildren: false });
    expect(nodes.get(20)).toMatchObject({ parentCode: null, hasChildren: false });
  });

  it('hides a group without active product in it or below it', () => {
    const nodes = byCode(visibleGroups(tree, new Set([12])));
    expect([...nodes.keys()].sort()).toEqual([10, 12]);
    expect(nodes.get(10)?.hasChildren).toBe(true);
  });

  it('hides inactive groups', () => {
    const rows = [...tree.filter((r) => r.code !== 12), g(12, 'INATIVO - PVC', 10, 2, false)];
    expect(byCode(visibleGroups(rows, new Set([12, 111]))).has(12)).toBe(false);
  });

  it('an orphan (parent hidden) becomes top level', () => {
    const rows = tree.map((r) => (r.code === 10 ? { ...r, active: false } : r));
    expect(byCode(visibleGroups(rows, new Set([12]))).get(12)?.parentCode).toBeNull();
  });

  it('a cycle is an anomaly: it ends, and the groups surface at the top level', () => {
    const cyclic = [g(1, 'A', 2, 1), g(2, 'B', 1, 2), g(3, 'C', 2, 3)];
    const nodes = byCode(visibleGroups(cyclic, new Set([1, 2, 3])));
    expect(nodes.get(1)?.parentCode).toBeNull();
    expect(nodes.get(2)?.parentCode).toBeNull();
  });

  it('orders by name', () => {
    expect(visibleGroups(tree, new Set([111, 12, 20])).map((n) => n.name)).toEqual(['Aço', 'Aço 1"', 'PVC', 'Serviços', 'Tubos']);
  });
});

describe('subtreeOf', () => {
  it('returns the group and descendants of any depth', () => {
    expect(subtreeOf(tree, 10).sort((a, b) => a - b)).toEqual([10, 11, 12, 111, 112]);
    expect(subtreeOf(tree, 11).sort((a, b) => a - b)).toEqual([11, 111, 112]);
  });

  it('a final group is just itself; an unknown code too', () => {
    expect(subtreeOf(tree, 111)).toEqual([111]);
    expect(subtreeOf([], 7)).toEqual([7]);
  });

  it('terminates on a cycle', () => {
    expect(subtreeOf([g(1, 'A', 2, 1), g(2, 'B', 1, 2)], 1).sort()).toEqual([1, 2]);
  });
});
