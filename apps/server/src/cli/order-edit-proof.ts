import { integrationOutbox, createDb, salesOrder, salesOrderItem } from '@salesforce/db';
import { erpSubmissionBlock } from '@salesforce/domain';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import { operatorIdentity } from './operator-identity.js';
import { enqueueOrderEdit, ORDER_EDIT_OPERATION, type OrderEditSnapshot } from '../orders/order-edit.js';
import { runMain } from '../process.js';

/**
 * One-shot proof of "Editar pedido" (owner ruling 2026-11-27), runs inside the worker container after deploy:
 *
 *   node dist/cli/order-edit-proof.js <NUNOTA> [<NUNOTA> ...]            (report only: nothing is written)
 *   node dist/cli/order-edit-proof.js --apply <NUNOTA> [<NUNOTA> ...]    (queues ONE edit per order)
 *
 * Run it in the API container (the API role enqueues; the worker role has no INSERT on the outbox and is not used here). Writing
 * needs --apply AND SF_DEPLOY_ENVIRONMENT=staging + SF_ERP_ENVIRONMENT=sandbox in the runtime. The audit row `order.edit_requested`
 * carries actor 'cli' and the OPERATOR identity (as the other operator scripts); the order's creator is never credited.
 *
 * It goes through the real code path and nothing else: it records the same `edit_order` outbox command the API records, with the
 * order's stored header and lines as the snapshot (no price change; to change prices use "Editar" on the site or the app). The
 * worker then revalidates live (fail-closed), proves the note is the order's own by origin id, deletes it with `CACSP.excluirNotas`
 * and recreates it through the normal delivery. No Sankhya call is made here, and the CLI never runs a second attempt for an order
 * that already has an edit command (SNK-6): the idempotency key is derived from the order id. Sandbox only. Prints identifiers only.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const numbers = args.filter((a) => /^\d+$/.test(a)).map(Number);
  if (url === undefined || url === '' || numbers.length === 0) {
    process.stderr.write('usage: DATABASE_URL=... node dist/cli/order-edit-proof.js [--apply] <NUNOTA> [...]\n');
    process.exitCode = 2;
    return;
  }
  // The runtime itself must say "staging + Sandbox" (the checks of the order delivery), not only the order's binding.
  if (apply && (process.env.SF_DEPLOY_ENVIRONMENT !== 'staging' || process.env.SF_ERP_ENVIRONMENT !== 'sandbox')) {
    process.stderr.write('refused: --apply runs only when SF_DEPLOY_ENVIRONMENT=staging and SF_ERP_ENVIRONMENT=sandbox\n');
    process.exitCode = 2;
    return;
  }
  const operator = operatorIdentity(process.env);
  const handle = createDb(url, { max: 2, applicationName: 'order-edit-proof' });
  try {
    const db = handle.db;
    const orders = await db.select().from(salesOrder).where(inArray(salesOrder.erpNumber, numbers));
    for (const nunota of numbers) {
      const order = orders.find((o) => o.erpNumber === nunota);
      if (order === undefined) {
        process.stdout.write(`nunota=${nunota} order=none (not a Force order or already replaced): skipped\n`);
        continue;
      }
      const items = await db.select().from(salesOrderItem).where(eq(salesOrderItem.orderId, order.id)).orderBy(asc(salesOrderItem.lineNo));
      const prior = await db
        .select({ id: integrationOutbox.id, status: integrationOutbox.status })
        .from(integrationOutbox)
        .where(and(eq(integrationOutbox.aggregateId, order.id), eq(integrationOutbox.operation, ORDER_EDIT_OPERATION)));
      process.stdout.write(
        `nunota=${nunota} order=${order.id} status=${order.status} env=${order.erpEnvironment ?? 'none'} items=${items.length} total=${order.estimatedTotal} priorEdits=${prior.length}\n`,
      );
      if (!apply) continue;
      if (order.erpEnvironment !== 'sandbox' || erpSubmissionBlock(order, { environment: 'sandbox' }) !== null) {
        process.stdout.write(`  refused: the order is not bound to the Sandbox (production is never touched)\n`);
        continue;
      }
      if (prior.length > 0) {
        process.stdout.write(`  refused: an edit command already exists for this order (one attempt only, SNK-6)\n`);
        continue;
      }
      if (order.status !== 'sent' && order.status !== 'rejected') {
        process.stdout.write(`  refused: the order is ${order.status}, not sent or rejected\n`);
        continue;
      }
      const snapshot: OrderEditSnapshot = {
        header: {
          customerCode: order.customerCode,
          sellerCode: order.sellerCode,
          negotiationTypeCode: order.negotiationTypeCode,
          topCode: order.topCode,
          carrierCode: order.carrierCode,
          freightType: order.freightType,
          discountAboveLimitAccepted: order.discountAboveLimitAccepted,
          notes: order.notes,
          estimatedTotal: order.estimatedTotal,
          discountAuthority: order.discountAuthority,
          configVersionId: order.configVersionId,
        },
        items: items.map((item) => ({
          lineNo: item.lineNo,
          productCode: item.productCode,
          productDescription: item.productDescription,
          unit: item.unit ?? '',
          quantity: item.quantity,
          unitListPrice: item.unitListPrice,
          priceState: item.priceState as 'priced' | 'zero' | 'none',
          priceTableCode: item.priceTableCode,
          priceVersionId: item.priceVersionId,
          discountPercent: item.discountPercent,
          estimatedLineTotal: item.estimatedLineTotal,
        })),
      };
      const at = new Date();
      const audit = new AuditService(db, () => at);
      const result = await db.transaction(async (tx) => {
        const queued = await enqueueOrderEdit(tx, order, { clientRequestId: order.id, actorAccountId: null, operator, snapshot }, at);
        if (queued.kind === 'queued') {
          await audit.record(
            {
              action: AUDIT_ACTIONS.orderEditRequested,
              actorAccountId: null,
              detail: { actor: 'cli', operator, orderId: order.id, itemCount: items.length, previousStatus: order.status, ...(order.erpNumber === null ? {} : { oldErpNumber: order.erpNumber }) },
            },
            tx,
          );
        }
        return queued;
      });
      process.stdout.write(`  edit queued: ${result.kind}\n`);
    }
  } finally {
    await handle.close();
  }
}

runMain('order-edit-proof', main);
