import { isSankhyaGatewayError, USER_PHOTO_MAX_BYTES, type SankhyaProfilePhotoPort } from '@salesforce/sankhya';
import { z } from 'zod';
import type { Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import { decideFailure, STALE_PROCESSING_MS } from './order-delivery.policy.js';
import type { ClaimedPhotoCommand, ProfilePhotoDeliveryStore } from './profile-photo-delivery.store.js';

/** The command as the API wrote it (job payloads are external input: validated, never trusted). */
export const ProfilePhotoCommandSchema = z.object({
  version: z.literal(1),
  accountId: z.string().uuid(),
  photoVersion: z.string().regex(/^[0-9a-f]{32}$/),
  /** Resolved by the API when the photo was queued (the worker's database role cannot read the account tables). */
  erpUser: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), code: z.number().int().min(0).max(2_147_483_647), sellerCode: z.number().int().optional() }),
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('ambiguous') }),
  ]),
  imageBase64: z.string().min(1).max(Math.ceil((USER_PHOTO_MAX_BYTES * 4) / 3) + 4),
});

export interface ProfilePhotoDeliveryDeps {
  readonly store: ProfilePhotoDeliveryStore;
  readonly gateway: SankhyaProfilePhotoPort;
  readonly logger: Logger;
  readonly now: Clock;
}

export interface PhotoRunSummary {
  readonly processed: number;
  readonly recovered: number;
}

const DEFAULT_SWEEP_LIMIT = 10;

/**
 * Delivers `profile_photo.write` commands to the ERP user's photo (spike S1.8, `TSIUSU.FOTO`). The write SETS a state (the user holds
 * one photo), so a resend of the same version is harmless and an uncertain answer is simply retried with the same key; what is
 * guarded instead is ORDER: a version that is no longer the account's current photo is never sent, so a late retry cannot overwrite a
 * newer photo. No user, or more than one, is a permanent rejection (never guessed). No network call inside a database transaction.
 */
export class ProfilePhotoDeliveryService {
  constructor(private readonly deps: ProfilePhotoDeliveryDeps) {}

  async runDue(options: { readonly signal?: AbortSignal | undefined; readonly limit?: number | undefined } = {}): Promise<PhotoRunSummary> {
    const now = this.deps.now();
    const recovered = await this.deps.store.recoverStale(now, new Date(now.getTime() - STALE_PROCESSING_MS));
    const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
    let processed = 0;
    while (processed < limit && options.signal?.aborted !== true) {
      const claimed = await this.deps.store.claimNext(this.deps.now());
      if (claimed === null) break;
      processed += 1;
      try {
        await this.deliver(claimed, options.signal);
      } catch (error) {
        // A bug or a database failure while recording the outcome: the row stays `processing` and is recovered later.
        this.deps.logger.error({ err: error, outboxId: claimed.outboxId }, 'profile photo delivery attempt failed unexpectedly');
      }
    }
    return { processed, recovered };
  }

  private async deliver(claimed: ClaimedPhotoCommand, signal: AbortSignal | undefined): Promise<void> {
    const { store, gateway } = this.deps;
    const parsed = ProfilePhotoCommandSchema.safeParse(claimed.payload);
    if (!parsed.success) return this.reject(claimed, 'validation', 'invalid_command', 'The stored command is not valid.');
    const command = parsed.data;
    if (await store.hasNewerVersion(claimed)) {
      return this.reject(claimed, 'superseded', 'photo_superseded', 'A newer photo was queued before this version was sent.');
    }
    const user = command.erpUser;
    if (user.kind === 'none') return this.reject(claimed, 'validation', 'photo_no_erp_user', 'The account has no linked ERP user.');
    if (user.kind === 'ambiguous') return this.reject(claimed, 'validation', 'photo_ambiguous_erp_user', 'More than one ERP user is linked to the account.');
    // Resolved through the seller link: the directory mirror (worker-side) may have dropped or moved the user since.
    if (user.sellerCode !== undefined && !(await store.directoryUserStillMapped(user.code, user.sellerCode))) {
      return this.reject(claimed, 'validation', 'erp_user_changed', 'The ERP user no longer belongs to the account.');
    }
    try {
      await store.markSending(claimed.outboxId, this.deps.now());
      await gateway.writeUserPhoto(
        { userCode: user.code, image: new Uint8Array(Buffer.from(command.imageBase64, 'base64')), idempotencyKey: claimed.originKey },
        signal === undefined ? {} : { signal },
      );
      await store.confirm({ claimed, userCode: user.code, at: this.deps.now() });
      this.deps.logger.info({ outboxId: claimed.outboxId, accountId: claimed.accountId, erpUserCode: user.code, attempts: claimed.attemptCount }, 'profile photo written to the ERP');
    } catch (error) {
      // A state write: after an uncertain answer the next attempt just writes again (same key); no origin lookup exists or is needed.
      const outcome = decideFailure(error, { phase: 'include', attemptCount: claimed.attemptCount, mayExist: false, hasErpNumber: false });
      const at = this.deps.now();
      const message = errorMessage(error);
      if (outcome.kind === 'retry') {
        await store.fail({ claimed, kind: 'retry', status: outcome.status, errorClass: outcome.errorClass, errorCode: outcome.errorCode, message, nextAttemptAt: new Date(at.getTime() + outcome.delayMs), consumesAttempt: outcome.consumesAttempt, at });
      } else {
        await store.fail({ claimed, kind: 'reject', status: 'rejected', errorClass: outcome.errorClass, errorCode: outcome.errorCode, message, nextAttemptAt: null, consumesAttempt: true, at });
      }
      this.deps.logger.warn({ outboxId: claimed.outboxId, outcome: outcome.kind, errorClass: outcome.errorClass, errorCode: outcome.errorCode, attempt: claimed.attemptCount }, 'profile photo delivery attempt did not complete');
    }
  }

  private async reject(claimed: ClaimedPhotoCommand, errorClass: string, errorCode: string, message: string): Promise<void> {
    await this.deps.store.fail({ claimed, kind: 'reject', status: 'rejected', errorClass, errorCode, message, nextAttemptAt: null, consumesAttempt: true, at: this.deps.now() });
    this.deps.logger.warn({ outboxId: claimed.outboxId, errorClass, errorCode }, 'profile photo delivery rejected');
  }
}

/** Short, secret-free text: the class of the error and, for gateway errors, its stable code. Never the request. */
function errorMessage(error: unknown): string {
  if (isSankhyaGatewayError(error)) return `${error.kind}: ${error.code}`;
  return `${error instanceof Error ? error.name : 'Error'}: unclassified failure`;
}
