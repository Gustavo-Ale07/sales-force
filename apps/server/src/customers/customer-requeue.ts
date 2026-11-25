import { customerRegistration, integrationOutbox, type Database } from '@salesforce/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { CustomerUpsertCommandSchema } from '../integration/customer-delivery.service.js';
import { CUSTOMER_UPSERT_AGGREGATE, CUSTOMER_UPSERT_OPERATION } from './customer-registration.repository.js';

export interface RequeueReport {
  /** Registrations whose delivery was queued again (complete data). */
  readonly requeued: string[];
  /** Registrations left alone because they have no seller (a manager sets it: PUT /customers/registrations/{id}/seller). */
  readonly missingSeller: string[];
  /** Left alone: the stored command is gone (purged after retention) or invalid, or the ERP said the document is taken. */
  readonly unrecoverable: string[];
}

/**
 * CUST-RT one-shot (runs in the worker container, `dist/cli/customer-requeue.js`): customers stuck in the old "Precisa de correção" or
 * "not yet confirmed" states. Complete data -> the outbox command is queued again (never a direct ERP call: the worker delivers it and
 * re-verifies by origin id before any write, SNK-4). No seller -> listed and left. Idempotent: a customer already queued, delivered or
 * left alone is not touched twice. Identifiers only; no personal data.
 */
export async function requeueStuckCustomers(db: Database, now: Date): Promise<RequeueReport> {
  const report: RequeueReport = { requeued: [], missingSeller: [], unrecoverable: [] };
  const rows = await db
    .select({
      id: customerRegistration.id,
      status: customerRegistration.status,
      rejectionCode: customerRegistration.rejectionCode,
      sellerCode: customerRegistration.sellerCode,
      outboxId: integrationOutbox.id,
      outboxStatus: integrationOutbox.status,
      nextAttemptAt: integrationOutbox.nextAttemptAt,
      payload: integrationOutbox.payload,
    })
    .from(customerRegistration)
    .innerJoin(
      integrationOutbox,
      and(
        eq(integrationOutbox.aggregateType, CUSTOMER_UPSERT_AGGREGATE),
        eq(integrationOutbox.operation, CUSTOMER_UPSERT_OPERATION),
        eq(integrationOutbox.aggregateId, customerRegistration.id),
      ),
    )
    // Stuck = refused (old "Precisa de correção") or parked for a person (old "not yet confirmed", no next attempt).
    .where(
      and(
        inArray(customerRegistration.status, ['rejected', 'unknown']),
        sql`(${customerRegistration.status} = 'rejected' or ${integrationOutbox.nextAttemptAt} is null)`,
      ),
    );

  for (const row of rows) {
    const payload = row.payload as { sellerCode?: unknown };
    const sellerCode = row.sellerCode ?? (typeof payload.sellerCode === 'number' ? payload.sellerCode : null);
    if (sellerCode === null) {
      report.missingSeller.push(row.id);
      continue;
    }
    // A duplicate document stays refused: queueing it again would only be refused again.
    if (row.rejectionCode === 'partner_document_duplicate' || !CustomerUpsertCommandSchema.safeParse({ ...payload, sellerCode }).success) {
      report.unrecoverable.push(row.id);
      continue;
    }
    // Compare-and-set on the stuck status: a concurrent run or a manual requeue wins, this one skips.
    const queued = await db.transaction(async (tx) => {
      const [outbox] = await tx
        .update(integrationOutbox)
        .set({
          status: 'pending',
          nextAttemptAt: now,
          attemptCount: 0,
          lastStep: null,
          lastErrorClass: null,
          lastErrorMessage: null,
          payload: sql`${integrationOutbox.payload} || jsonb_build_object('sellerCode', ${sellerCode}::int)`,
          updatedAt: now,
        })
        .where(and(eq(integrationOutbox.id, row.outboxId), inArray(integrationOutbox.status, ['rejected', 'unknown']), sql`(${integrationOutbox.status} = 'rejected' or ${integrationOutbox.nextAttemptAt} is null)`))
        .returning({ id: integrationOutbox.id });
      if (outbox === undefined) return false;
      await tx
        .update(customerRegistration)
        .set({ status: 'pending', rejectionCode: null, sellerCode, updatedAt: now })
        .where(eq(customerRegistration.id, row.id));
      return true;
    });
    if (queued) report.requeued.push(row.id);
  }
  return report;
}
