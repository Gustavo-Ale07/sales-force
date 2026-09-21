import { createDb } from '@salesforce/db';
import { isLoopbackDatabaseUrl } from '../../src/config/env.js';
import { seedDemoMirror } from '../helpers/commercial-fixture.js';

/**
 * TEST-ONLY tool: writes the synthetic demo dataset of the fake Sankhya gateway into the `erp_*`
 * mirror tables of a LOCAL throwaway database, for manual verification of the commercial endpoints
 * before the worker mirror sync (Stage 3B) is available. Not the production seed and not a sync:
 * it refuses any database that is not loopback.
 *
 *   DATABASE_URL=postgres://... npx tsx test/tools/seed-demo-mirror.ts
 */
const url = process.env['DATABASE_URL'];
if (url === undefined || !isLoopbackDatabaseUrl(url)) {
  process.stderr.write('seed-demo-mirror: DATABASE_URL must be set and point to a loopback database.\n');
  process.exit(1);
}

const db = createDb(url, { max: 2, applicationName: 'salesforce-seed-demo-mirror' });
try {
  await seedDemoMirror(db);
  process.stdout.write('demo mirror written (sellers, customers, products, price tables, versions, list prices)\n');
} finally {
  await db.close();
}
