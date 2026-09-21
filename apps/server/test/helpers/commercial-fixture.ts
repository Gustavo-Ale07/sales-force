import { createHash } from 'node:crypto';
import { erpCustomer, erpListPrice, erpPriceTable, erpPriceTableVersion, erpProduct, erpSeller, type DbHandle } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_ACCOUNTS, DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { InstallationConfigurationRepository } from '../../src/configuration/configuration.repository.js';
import { createOperatorAccountService } from '../../src/cli/operator.js';
import type { Clock } from '../../src/platform/tokens.js';
import { TEST_HASH_PARAMS, TEST_PASSWORD } from './auth.js';

/**
 * TEST-ONLY fixtures for the commercial endpoints (Stage 3A). Synthetic data: the fake gateway's demo
 * dataset written straight into the `erp_*` mirror tables (the worker sync of Stage 3B is the real
 * writer; the API never writes these tables). Not the production seed.
 */
const CHUNK = 200;

async function inChunks<T>(rows: readonly T[], write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let index = 0; index < rows.length; index += CHUNK) await write(rows.slice(index, index + CHUNK));
}

const hashOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Writes the demo dataset into the mirror tables. Idempotent for an empty database only. */
export async function seedDemoMirror(handle: DbHandle, syncedAt: Date = new Date('2026-09-18T00:00:00.000Z')): Promise<void> {
  const dataset = getDemoDataset();
  const { db } = handle;
  const base = (row: unknown) => ({ contentHash: hashOf(row), syncedAt });

  await inChunks(dataset.sellers, (chunk) =>
    db.insert(erpSeller).values(chunk.map((s) => ({ code: s.code, name: s.name, active: s.active, ...base(s) }))),
  );
  await inChunks(dataset.customers, (chunk) =>
    db.insert(erpCustomer).values(
      chunk.map((c) => ({
        code: c.code,
        name: c.name,
        tradeName: c.tradeName,
        taxId: c.document,
        sellerCode: c.sellerCode,
        priceTableCode: c.priceTableCode,
        creditLimit: c.creditLimit,
        active: c.active,
        isCustomer: true,
        blockedRaw: c.blocked ? 'S' : 'N',
        ...base(c),
      })),
    ),
  );
  const groupName = new Map(dataset.productGroups.map((g) => [g.code, g.name]));
  await inChunks(dataset.products, (chunk) =>
    db.insert(erpProduct).values(
      chunk.map((p) => ({
        code: p.code,
        description: p.description,
        reference: p.reference,
        brand: p.brand,
        unit: p.unit,
        groupCode: p.groupCode,
        groupName: p.groupCode === null ? null : (groupName.get(p.groupCode) ?? null),
        usageCode: p.usageCode,
        active: p.active,
        ...base(p),
      })),
    ),
  );
  await db.insert(erpPriceTable).values(
    dataset.priceTables.map((t) => ({
      code: t.code,
      name: t.name,
      active: t.active,
      originTableCode: t.originTableCode,
      percent: t.percent,
      ...base(t),
    })),
  );
  await db.insert(erpPriceTableVersion).values(
    dataset.priceTableVersions.map((v) => ({
      versionId: v.versionId,
      tableCode: v.tableCode,
      effectiveFrom: new Date(v.effectiveFrom),
      ...base(v),
    })),
  );
  await inChunks(dataset.listPrices, (chunk) =>
    db.insert(erpListPrice).values(
      chunk.map((p) => ({ versionId: p.versionId, productCode: p.productCode, unitPrice: p.unitPrice, ...base(p) })),
    ),
  );
}

export async function storeConfiguration(
  handle: DbHandle,
  configuration: InstallationConfiguration = DEMO_CONFIGURATION,
  at: Date = new Date('2026-09-18T00:00:00.000Z'),
): Promise<string> {
  const repository = new InstallationConfigurationRepository(handle.db);
  await repository.saveSnapshot(configuration, at);
  const current = await repository.findCurrent();
  if (current === null) throw new Error('configuration was not stored');
  return current.id;
}

export interface DemoAccounts {
  readonly ids: Readonly<Record<string, string>>;
  readonly configVersionId: string;
}

/** The four demo accounts with the demo configuration's seller links (manager 101, seller1 103, seller2 107). */
export async function seedDemoAccounts(
  handle: DbHandle,
  options: { password?: string; clock?: Clock; configuration?: InstallationConfiguration } = {},
): Promise<DemoAccounts> {
  const configuration = options.configuration ?? DEMO_CONFIGURATION;
  const configVersionId = await storeConfiguration(handle, configuration);
  const { accounts, repository } = createOperatorAccountService(handle, TEST_HASH_PARAMS, options.clock);
  const ids: Record<string, string> = {};
  for (const demo of DEMO_ACCOUNTS) {
    ids[demo.email] = await accounts.createAccount({
      email: demo.email,
      displayName: demo.displayName,
      role: demo.role,
      password: options.password ?? TEST_PASSWORD,
    });
  }
  for (const link of configuration.customers.accountSellerLinks) {
    const account = await repository.findByEmail(link.accountEmail);
    if (account === null) continue;
    await accounts.linkSeller(account.id, link.sellerCode, configVersionId);
  }
  return { ids, configVersionId };
}
