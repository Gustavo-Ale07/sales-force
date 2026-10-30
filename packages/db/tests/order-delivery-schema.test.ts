import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';
import { startPostgres, type TestPostgres } from './helpers.js';

let pgc: TestPostgres;
let url: string;
const quiet = { log: () => undefined };

async function query(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

const ACC = '018f0000-0000-7000-8000-0000000000a1';
const CFG = '018f0000-0000-7000-8000-0000000000a2';
const ORD = '018f0000-0000-7000-8000-0000000000a3';
const OUT = '018f0000-0000-7000-8000-0000000000a4';

beforeAll(async () => {
  pgc = await startPostgres();
  url = await pgc.createDatabase();
  await runMigrations(url, quiet);
  await query(`INSERT INTO account (id, email, display_name, password_hash, role) VALUES ($1, 'd@example.test', 'D', 'x', 'seller')`, [ACC]);
  await query(`INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at) VALUES ($1, 'v', 'demo', '{}', 'h', now())`, [CFG]);
  await query(`INSERT INTO sales_order (id, customer_code, created_by_account_id, client_request_id, config_version_id, dataset_origin, erp_environment) VALUES ($1, 1, $2, $3, $4, 'sankhya', 'sandbox')`, [ORD, ACC, '018f0000-0000-7000-8000-0000000000a5', CFG]);
  await query(`INSERT INTO integration_outbox (id, aggregate_type, aggregate_id, operation, payload) VALUES ($1, 'sales_order', $2, 'send_order', '{}')`, [OUT, ORD]);
}, 120_000);
afterAll(async () => {
  await pgc?.stop();
});

describe('0016 order delivery schema (SNK-7)', () => {
  it('erp_number accepts a positive 32-bit integer only', async () => {
    await expect(query(`UPDATE sales_order SET erp_number = 0 WHERE id = $1`, [ORD])).rejects.toThrow(/sales_order_erp_number_chk/);
    await expect(query(`UPDATE sales_order SET erp_number = 2147483648 WHERE id = $1`, [ORD])).rejects.toThrow(/sales_order_erp_number_chk/);
  });

  it('erp_number is write-once: null -> value works, value -> other or null is refused, same value is a no-op', async () => {
    await query(`UPDATE sales_order SET erp_number = 5000 WHERE id = $1`, [ORD]);
    await expect(query(`UPDATE sales_order SET erp_number = 5001 WHERE id = $1`, [ORD])).rejects.toThrow(/write-once/);
    await expect(query(`UPDATE sales_order SET erp_number = NULL WHERE id = $1`, [ORD])).rejects.toThrow(/write-once/);
    await query(`UPDATE sales_order SET erp_number = 5000 WHERE id = $1`, [ORD]);
    expect(await query(`SELECT erp_number FROM sales_order WHERE id = $1`, [ORD])).toEqual([{ erp_number: '5000' }]);
  });

  it('last_step accepts only the informational steps', async () => {
    await query(`UPDATE integration_outbox SET last_step = 'awaiting_confirmation' WHERE id = $1`, [OUT]);
    await expect(query(`UPDATE integration_outbox SET last_step = 'made_up' WHERE id = $1`, [OUT])).rejects.toThrow(/integration_outbox_last_step_chk/);
  });

  it('the dry-run record is unique per outbox row and disappears with it', async () => {
    const insert = (id: string) =>
      query(`INSERT INTO integration_order_dry_run (id, outbox_id, order_id, payload, payload_hash) VALUES ($1, $2, $3, '{}', 'h')`, [id, OUT, ORD]);
    await insert('018f0000-0000-7000-8000-0000000000b1');
    await expect(insert('018f0000-0000-7000-8000-0000000000b2')).rejects.toThrow(/integration_order_dry_run_outbox_uq/);
    await query(`DELETE FROM integration_outbox WHERE id = $1`, [OUT]);
    expect(await query(`SELECT count(*)::int AS n FROM integration_order_dry_run`)).toEqual([{ n: 0 }]);
  });
});
