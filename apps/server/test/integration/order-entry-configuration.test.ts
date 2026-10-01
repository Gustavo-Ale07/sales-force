import { ConfigurationResponseSchema, OrderEntryConfigurationSchema } from '@salesforce/contracts';
import { DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InstallationConfigurationRepository } from '../../src/configuration/configuration.repository.js';
import { createTestAccount, TEST_PASSWORD } from '../helpers/auth.js';
import { loginCookie, startAuthApp, type AuthApp } from '../helpers/auth-app.js';
import { createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/**
 * `GET /order-entry/configuration` (getOrderEntryConfiguration): the minimal slice the "Novo pedido"
 * screen reads, open to seller/manager/admin — unlike `GET /configuration` (admin-only, kept as a
 * regression guard here). The actual security property under test is the response SHAPE: it must
 * never leak syncStates/gateway/integration or any customers/pricing/financial/features key.
 */

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const DATASET = { environment: 'sandbox', datasetId: 'plac-sandbox-real-1' } as const;

async function setupApp(dataset: typeof DATASET | null = null): Promise<{ ctx: AuthApp; database: MigratedDatabase }> {
  const database = await createMigratedDatabase(postgres);
  opened.push(() => database.handle.close());
  const repository = new InstallationConfigurationRepository(database.handle.db);
  await repository.saveSnapshot(DEMO_CONFIGURATION, new Date('2026-09-18T00:00:00.000Z'));
  const ctx = await startAuthApp(postgres, opened, { database, dataset });
  return { ctx, database };
}

const ORDER_ENTRY_URL = '/api/v1/order-entry/configuration';
const CONFIGURATION_URL = '/api/v1/configuration';

describe('GET /api/v1/order-entry/configuration (getOrderEntryConfiguration)', () => {
  it.each(['seller', 'manager', 'admin'] as const)(
    'gives a signed-in %s exactly the order-entry slice, nothing more',
    async (role) => {
      const { ctx } = await setupApp(DATASET);
      await createTestAccount(ctx.database.handle, { email: `oe-${role}@example.test`, role });
      const cookie = await loginCookie(ctx, `oe-${role}@example.test`, TEST_PASSWORD);

      const response = await ctx.app.inject({ method: 'GET', url: ORDER_ENTRY_URL, headers: { cookie } });
      expect(response.statusCode).toBe(200);

      const body: unknown = response.json();
      const parsed = OrderEntryConfigurationSchema.parse(body);
      expect(parsed).toEqual({
        dataset: { environment: 'sandbox', datasetId: 'plac-sandbox-real-1' },
        general: { enabled: true },
        sales: {
          defaultNegotiationTypeCode: 2,
          negotiationTypes: [
            { code: 2, label: 'À vista (demonstração)' },
            { code: 3, label: '28 dias (demonstração)' },
          ],
          orderBehavior: { allowDraftWithoutPrice: false },
        },
        products: { productWithoutPrice: { orderable: false } },
      });

      // The actual security property: no admin/integration-scoped key ever leaks into this payload.
      expect(Object.keys(body as Record<string, unknown>).sort()).toEqual(['dataset', 'general', 'products', 'sales']);
      const asRecord = body as Record<string, unknown>;
      expect(asRecord).not.toHaveProperty('syncStates');
      expect(asRecord).not.toHaveProperty('gateway');
      expect(asRecord).not.toHaveProperty('integration');
      expect(asRecord).not.toHaveProperty('contentHash');
      expect(asRecord['sales']).not.toHaveProperty('orderTopCode');
      expect(asRecord['sales']).not.toHaveProperty('quotationTopCode');
      expect(asRecord['sales']).not.toHaveProperty('confirmationBehavior');
      expect(Object.keys(asRecord)).not.toContain('customers');
      expect(Object.keys(asRecord)).not.toContain('pricing');
      expect(Object.keys(asRecord)).not.toContain('financial');
      expect(Object.keys(asRecord)).not.toContain('features');
      expect(Object.keys(asRecord)).not.toContain('source');
      expect(Object.keys(asRecord)).not.toContain('schemaVersion');
    },
  );

  it('returns dataset null when the installation declares no identity', async () => {
    const { ctx } = await setupApp(null);
    await createTestAccount(ctx.database.handle, { email: 'oe-null@example.test', role: 'seller' });
    const cookie = await loginCookie(ctx, 'oe-null@example.test', TEST_PASSWORD);
    const response = await ctx.app.inject({ method: 'GET', url: ORDER_ENTRY_URL, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect((response.json() as Record<string, unknown>)['dataset']).toBeNull();
  });

  it('is 401 without a session', async () => {
    const { ctx } = await setupApp();
    const response = await ctx.app.inject({ method: 'GET', url: ORDER_ENTRY_URL });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/v1/configuration stays admin-only (regression guard)', () => {
  it.each(['seller', 'manager'] as const)('is still 403 for %s', async (role) => {
    const { ctx } = await setupApp();
    await createTestAccount(ctx.database.handle, { email: `cfg-${role}@example.test`, role });
    const cookie = await loginCookie(ctx, `cfg-${role}@example.test`, TEST_PASSWORD);

    const response = await ctx.app.inject({ method: 'GET', url: CONFIGURATION_URL, headers: { cookie } });
    expect(response.statusCode).toBe(403);
  });

  it('is still 200 for admin, with the full admin payload', async () => {
    const { ctx } = await setupApp();
    await createTestAccount(ctx.database.handle, { email: 'cfg-admin@example.test', role: 'admin' });
    const cookie = await loginCookie(ctx, 'cfg-admin@example.test', TEST_PASSWORD);

    const response = await ctx.app.inject({ method: 'GET', url: CONFIGURATION_URL, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const parsed = ConfigurationResponseSchema.parse(response.json());
    expect(parsed.configuration.sales.negotiationTypes).toEqual([
      { code: 2, label: 'À vista (demonstração)' },
      { code: 3, label: '28 dias (demonstração)' },
    ]);
  });
});
