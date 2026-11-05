import { createDb } from '@salesforce/db';
import { loadWorkerConfig } from './config/worker-env.js';
import { AuditService } from './iam/audit.service.js';
import { requeueDeliveredOrder, ResendRefused } from './integration/order-resend.js';
import { createLogger } from './observability/logger.js';
import { runMain } from './process.js';

/**
 * M1 (SNK-7 roteiro §3, step 3), worker container only:
 * `node dist/ops-order-resend.js <orderId>` re-queues an already delivered order with the SAME outbox row and origin id.
 * The running worker then asks the ERP by origin first (SNK-4), finds the note and only links it. This command writes
 * nothing to the ERP and never talks to Sankhya; refused unless the worker is in live mode.
 */
runMain('ops-order-resend', async () => {
  const orderId = process.argv.slice(2).filter((arg) => arg !== '--')[0];
  if (orderId === undefined || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    throw new Error('Usage: node dist/ops-order-resend.js <orderId (uuid)>');
  }
  const { env, orderWrite } = loadWorkerConfig(process.env);
  if (orderWrite.mode !== 'live') {
    throw new Error(`Refused: the order write mode is "${orderWrite.mode}"; re-queueing only makes sense in live mode.`);
  }
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'ops-order-resend' });
  const db = createDb(env.DATABASE_URL.reveal(), { max: 2, applicationName: 'salesforce-ops-order-resend' });
  try {
    const result = await requeueDeliveredOrder(db, new AuditService(db.db, () => new Date()), orderId, new Date());
    logger.info({ orderId, outboxId: result.outboxId, originId: result.originId }, 'order re-queued with the same idempotency key');
    process.stdout.write(`re-queued: outbox=${result.outboxId} origin=${result.originId} erpNumber=${result.erpNumber}\n`);
    process.stdout.write('The worker will look the note up by origin and link it; no second note is created.\n');
  } catch (error) {
    if (error instanceof ResendRefused) {
      process.stdout.write(`refused [${error.reason}]: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await db.close();
  }
});
