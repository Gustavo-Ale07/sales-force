import { ProductGroupsResponseSchema } from '@salesforce/contracts';
import { erpProduct, erpProductGroup } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Grupo > Subgrupo > Linha: the hierarchy comes from `erp_product_group` (by parent code), descendants are resolved on the
 * server, and an empty table falls back to the flat list derived from the products (deploy window before the first sync).
 */
const dataset = getDemoDataset();
const [A, B, C] = dataset.productGroups.map((group) => group.code);
const SYNCED = new Date('2026-09-18T00:00:00.000Z');

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

async function codesIn(group: number): Promise<number[]> {
  const codes: number[] = [];
  for (let page = 1; ; page += 1) {
    const { status, body } = await ctx.call('manager', 'GET', `/products?group=${group}&page=${page}&pageSize=100`);
    expect(status).toBe(200);
    codes.push(...body.items.map((p: Json) => p.code as number));
    if (codes.length >= body.total || body.items.length === 0) return codes.sort((a, b) => a - b);
  }
}

const row = (code: number, name: string, parentCode: number | null, degree: number, active = true) => ({
  code,
  name,
  parentCode,
  degree,
  analytic: parentCode !== null,
  active,
  contentHash: `h${code}`,
  syncedAt: SYNCED,
});

describe('product group hierarchy', () => {
  let directA: number[] = [];
  let directB: number[] = [];
  let directC: number[] = [];

  it('falls back to the flat list while erp_product_group is empty', async () => {
    const { status, body } = await ctx.call('manager', 'GET', '/product-groups');
    expect(status).toBe(200);
    expect(ProductGroupsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.hierarchical).toBe(false);
    expect(body.items.every((g: Json) => g.parentCode === null && g.hasChildren === false)).toBe(true);
    expect(body.items.map((g: Json) => g.code).sort()).toEqual([A, B, C].map(Number).sort());
    directA = await codesIn(A as number);
    directB = await codesIn(B as number);
    directC = await codesIn(C as number);
    expect(directA.length).toBeGreaterThan(0);
  });

  it('serves the hierarchy: finals, children, hidden inactive and empty groups', async () => {
    const { db } = ctx.database.handle;
    await db.insert(erpProductGroup).values([
      row(9001, 'Pai', null, 1), // no product of its own, parent of A
      row(A as number, 'A', 9001, 2),
      row(B as number, 'B', A as number, 3), // third level
      row(C as number, 'C', null, 1), // final at level 1
      row(9002, 'INATIVO - X', null, 1, false),
      row(9003, 'Vazio', null, 1), // active, no product in or below
    ]);
    const { body } = await ctx.call('manager', 'GET', '/product-groups');
    expect(ProductGroupsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.hierarchical).toBe(true);
    const byCode = new Map<number, Json>(body.items.map((g: Json) => [g.code, g]));
    expect(byCode.get(9001)).toMatchObject({ parentCode: null, hasChildren: true });
    expect(byCode.get(A as number)).toMatchObject({ parentCode: 9001, hasChildren: true });
    expect(byCode.get(B as number)).toMatchObject({ parentCode: A, hasChildren: false });
    expect(byCode.get(C as number)).toMatchObject({ parentCode: null, hasChildren: false });
    expect(byCode.has(9002)).toBe(false);
    expect(byCode.has(9003)).toBe(false);
  });

  it('filters by all descendants of any depth, resolved on the server', async () => {
    expect(await codesIn(9001)).toEqual([...directA, ...directB].sort((a, b) => a - b));
    expect(await codesIn(A as number)).toEqual([...directA, ...directB].sort((a, b) => a - b));
    expect(await codesIn(B as number)).toEqual(directB);
    expect(await codesIn(C as number)).toEqual(directC);
  });

  it('"Sem grupo" is offered only with an active product without group, and filters them (group=0)', async () => {
    expect((await ctx.call('manager', 'GET', '/product-groups')).body.hasUngrouped).toBe(false);
    const target = directC[0] as number;
    await ctx.database.handle.db.update(erpProduct).set({ groupCode: null, groupName: null }).where(eq(erpProduct.code, target));
    const { body } = await ctx.call('manager', 'GET', '/product-groups');
    expect(body.hasUngrouped).toBe(true);
    expect(body.items.some((g: Json) => g.code === 0)).toBe(false); // group 0 is never a mirrored group
    expect(await codesIn(0)).toContain(target);
    expect(await codesIn(C as number)).not.toContain(target);
  });

  it('a cycle in the hierarchy never hangs the filter', async () => {
    const { db } = ctx.database.handle;
    await db.insert(erpProductGroup).values([row(9010, 'Ciclo 1', 9011, 2), row(9011, 'Ciclo 2', 9010, 2)]);
    const target = directA[0] as number;
    await db.update(erpProduct).set({ groupCode: 9010, groupName: 'Ciclo 1' }).where(eq(erpProduct.code, target));
    const groups = await ctx.call('manager', 'GET', '/product-groups');
    expect(groups.status).toBe(200);
    expect(groups.body.items.find((g: Json) => g.code === 9010)?.parentCode).toBeNull();
    expect(await codesIn(9011)).toContain(target);
  });
});
