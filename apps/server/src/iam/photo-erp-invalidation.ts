import { integrationOutbox, type Database } from '@salesforce/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

const ACCOUNT_PHOTO_AGGREGATE = 'account_photo';
const ACCOUNT_PHOTO_OPERATION = 'profile_photo.write';

type Writer = Pick<Database, 'update'>;

/**
 * Closes the not-yet-delivered ERP photo writes of an account (spike S1.8): `pending`, `processing` or `unknown` rows become
 * `rejected` and lose their image. Called in the SAME transaction as what makes them stale: the photo was removed
 * (`photo_removed`) or the account -> ERP user mapping changed (`erp_user_changed`), so a photo is never exported to a user it no
 * longer belongs to. A row already sent cannot be recalled; that is the (documented) limit of an asynchronous delivery.
 */
export async function rejectPendingPhotoErpWrites(writer: Writer, accountId: string, code: 'photo_removed' | 'erp_user_changed', at: Date): Promise<number> {
  const rows = await writer
    .update(integrationOutbox)
    .set({
      status: 'rejected',
      nextAttemptAt: null,
      lastStep: null,
      lastErrorClass: 'validation',
      lastErrorMessage: `${code}: the queued photo write is no longer valid.`,
      payload: sql`${integrationOutbox.payload} - 'imageBase64'`,
      updatedAt: at,
    })
    .where(
      and(
        eq(integrationOutbox.aggregateType, ACCOUNT_PHOTO_AGGREGATE),
        eq(integrationOutbox.operation, ACCOUNT_PHOTO_OPERATION),
        eq(integrationOutbox.aggregateId, accountId),
        inArray(integrationOutbox.status, ['pending', 'processing', 'unknown']),
      ),
    )
    .returning({ id: integrationOutbox.id });
  return rows.length;
}
