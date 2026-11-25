import { createDb } from '@salesforce/db';
import { requeueStuckCustomers } from '../customers/customer-requeue.js';
import { runMain } from '../process.js';

/**
 * One-shot (CUST-RT), runs inside the worker container: `node dist/cli/customer-requeue.js`.
 * Customers stuck in the old "Precisa de correção" / "not confirmed" states: complete data -> delivery queued again through the outbox;
 * no seller -> only listed. Never writes Sankhya itself. Prints identifiers only. Exit 0.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    process.stderr.write('DATABASE_URL is not set\n');
    process.exitCode = 2;
    return;
  }
  const handle = createDb(url, { max: 2, applicationName: 'customer-requeue' });
  try {
    const report = await requeueStuckCustomers(handle.db, new Date());
    process.stdout.write(`requeued=${report.requeued.length} missing_seller=${report.missingSeller.length} unrecoverable=${report.unrecoverable.length}\n`);
    if (report.requeued.length > 0) process.stdout.write(`requeued ids: ${report.requeued.join(', ')}\n`);
    if (report.missingSeller.length > 0) process.stdout.write(`missing seller ids (set it with PUT /customers/registrations/{id}/seller): ${report.missingSeller.join(', ')}\n`);
    if (report.unrecoverable.length > 0) process.stdout.write(`left alone ids: ${report.unrecoverable.join(', ')}\n`);
  } finally {
    await handle.close();
  }
}

runMain('customer-requeue', main);
