import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PHOTO_UPLOAD_MAX_BYTES, type ProfilePhoto, type PutProfilePhotoRequest } from '@salesforce/contracts';
import { matchesIfNoneMatch } from '../catalog/product-image.js';
import { AppError } from '../http/app-error.js';
import { isObjectStoreError, type ObjectStore } from '../media/object-store.js';
import { isAccountPhotoError, renderAccountPhoto, toErpJpeg } from '../media/account-photo-renderer.js';
import { errorLogFields, type Logger } from '../observability/logger.js';
import { ACCOUNT_PHOTO_STORE, CLOCK, LOGGER, PROFILE_PHOTO_ERP_WRITE_ENABLED, type Clock } from '../platform/tokens.js';
import { uuidv7 } from '../platform/ids.js';
import { AccountPhotoRepository, type AccountPhotoRecord } from './account-photo.repository.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import type { CurrentUser } from './current-user.js';

/** A change is refused when the previous one is younger than this (the render is CPU work done in the request). */
export const ACCOUNT_PHOTO_MIN_INTERVAL_MS = 5_000;
/** Bound of the in-process last-attempt map (entries older than the interval are useless and dropped first). */
export const ACCOUNT_PHOTO_ATTEMPT_MAP_MAX = 10_000;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type ServedAccountPhoto =
  | { readonly kind: 'not_modified'; readonly etag: string }
  | { readonly kind: 'image'; readonly etag: string; readonly bytes: Uint8Array };

/** The public cache key of a stored rendition (a prefix of its sha256). */
export function photoVersionOf(record: Pick<AccountPhotoRecord, 'contentHash'>): string {
  return record.contentHash.slice(0, 32);
}

/**
 * Own profile photo (the Force's own storage; nothing is written to the ERP). The service only ever acts on the
 * caller's account id: there is no parameter to name another account.
 */
@Injectable()
export class AccountPhotoService {
  private readonly lastAttempt = new Map<string, number>();

  constructor(
    @Inject(AccountPhotoRepository) private readonly photos: AccountPhotoRepository,
    @Inject(ACCOUNT_PHOTO_STORE) private readonly store: ObjectStore | null,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    // Spike S1.8: closed unless the owner opens SANKHYA_PROFILE_PHOTO_WRITE_ENABLED (staging only). Absent = closed.
    @Optional() @Inject(PROFILE_PHOTO_ERP_WRITE_ENABLED) private readonly erpWriteEnabled: boolean = false,
  ) {}

  /** The version to publish in the session, or null (no photo, or photo storage not configured). */
  async versionOf(accountId: string): Promise<string | null> {
    if (this.store === null) return null;
    const record = await this.photos.find(accountId);
    return record === null ? null : photoVersionOf(record);
  }

  async put(user: CurrentUser, body: PutProfilePhotoRequest): Promise<ProfilePhoto> {
    const store = this.requireStore();
    // Before any decoding: every attempt (also a failed one) consumes the slot.
    const now = await this.claimSlot(user.accountId);
    const upload = decodeUpload(body.dataBase64);
    const previous = await this.photos.find(user.accountId);
    let rendered;
    try {
      rendered = await renderAccountPhoto(upload, body.contentType, body.crop);
    } catch (error) {
      if (isAccountPhotoError(error)) {
        if (error.code === 'busy' || error.code === 'timeout') {
          this.logger.warn({ accountId: user.accountId, reason: error.code }, 'account photo render refused');
          throw new AppError('service_unavailable');
        }
        throw new AppError('validation_failed', {
          details: { issues: [{ path: error.code === 'crop_invalid' ? 'crop' : 'dataBase64', code: `photo_${error.code}` }] },
        });
      }
      throw error;
    }
    const contentHash = createHash('sha256').update(rendered.bytes).digest('hex');
    const storageKey = `account-photos/${user.accountId}/${contentHash}`;
    try {
      await store.put(storageKey, rendered.bytes);
    } catch (error) {
      throw this.unavailable(error);
    }
    const version = contentHash.slice(0, 32);
    // The ERP copy is prepared BEFORE the transaction (CPU work, no database held); nothing is queued while the flag is closed.
    let erpImageBase64: string | null = null;
    if (this.erpWriteEnabled) {
      try {
        erpImageBase64 = Buffer.from(await toErpJpeg(rendered.bytes)).toString('base64');
      } catch (error) {
        await this.discardUnlessKept(store, storageKey, previous);
        if (isAccountPhotoError(error)) throw new AppError('validation_failed', { details: { issues: [{ path: 'dataBase64', code: `photo_${error.code}` }] } });
        throw error;
      }
    }
    try {
      await this.photos.transaction(async (tx) => {
        await this.photos.upsert(
          {
            accountId: user.accountId,
            contentType: rendered.contentType,
            byteLength: rendered.bytes.byteLength,
            sizePx: rendered.sizePx,
            contentHash,
            storageKey,
            at: now,
          },
          tx,
        );
        if (erpImageBase64 !== null) {
          // Same transaction as the change (STACK-6): either both exist or neither. Idempotent per account + version.
          await this.photos.enqueueErpWrite({ id: uuidv7(now.getTime()), accountId: user.accountId, photoVersion: version, imageBase64: erpImageBase64, at: now }, tx);
        }
        // Identifiers and sizes only: never image content.
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.accountPhotoChanged,
            actorAccountId: user.accountId,
            detail: { version, sizePx: rendered.sizePx, byteLength: rendered.bytes.byteLength, replaced: previous !== null },
          },
          tx,
        );
      });
    } catch (error) {
      if (previous?.storageKey !== storageKey) await this.discard(store, storageKey);
      throw error;
    }
    if (previous !== null && previous.storageKey !== storageKey) await this.discard(store, previous.storageKey);
    return { version, contentType: 'image/webp', sizePx: rendered.sizePx, updatedAt: now.toISOString() };
  }

  private async discardUnlessKept(store: ObjectStore, key: string, previous: AccountPhotoRecord | null): Promise<void> {
    if (previous?.storageKey !== key) await this.discard(store, key);
  }

  /** Idempotent. */
  async remove(user: CurrentUser): Promise<void> {
    const store = this.requireStore();
    await this.claimSlot(user.accountId);
    const removed = await this.photos.transaction(async (tx) => {
      const row = await this.photos.remove(user.accountId, tx);
      if (row !== null) {
        await this.audit.record(
          { action: AUDIT_ACTIONS.accountPhotoRemoved, actorAccountId: user.accountId, detail: { version: photoVersionOf(row) } },
          tx,
        );
      }
      return row;
    });
    if (removed !== null) await this.discard(store, removed.storageKey);
  }

  async serve(user: CurrentUser, ifNoneMatch: string | undefined): Promise<ServedAccountPhoto | null> {
    const store = this.requireStore();
    const record = await this.photos.find(user.accountId);
    if (record === null) return null;
    const etag = `"${photoVersionOf(record)}"`;
    if (matchesIfNoneMatch(ifNoneMatch, etag)) return { kind: 'not_modified', etag };
    let bytes: Uint8Array | null;
    try {
      bytes = await store.get(record.storageKey, { expectedBytes: record.byteLength });
    } catch (error) {
      throw this.unavailable(error);
    }
    if (bytes === null) {
      // The record exists but the object is gone: a storage defect, not "no photo".
      this.logger.error({ accountId: user.accountId }, 'account photo object is missing');
      throw new AppError('service_unavailable');
    }
    return { kind: 'image', etag, bytes };
  }

  /**
   * One change slot per account per interval, shared by PUT and DELETE, consumed by every attempt. Two guards:
   * the in-process map (synchronous check-and-set: parallel requests of one process cannot both pass, and it covers
   * accounts without a row) and the database claim (serialized by an advisory lock; the guard that holds across API
   * instances once a row exists). Answers the attempt time.
   */
  private async claimSlot(accountId: string): Promise<Date> {
    const now = this.clock();
    const limited = (): AppError =>
      new AppError('rate_limited', { retryAfterSeconds: Math.ceil(ACCOUNT_PHOTO_MIN_INTERVAL_MS / 1000) });
    const last = this.lastAttempt.get(accountId);
    if (last !== undefined && now.getTime() - last < ACCOUNT_PHOTO_MIN_INTERVAL_MS) throw limited();
    this.recordAttempt(accountId, now.getTime());
    if (!(await this.photos.claimSlot(accountId, now, ACCOUNT_PHOTO_MIN_INTERVAL_MS))) throw limited();
    return now;
  }

  private recordAttempt(accountId: string, at: number): void {
    this.lastAttempt.delete(accountId); // re-insert: Map keeps insertion order = age order
    this.lastAttempt.set(accountId, at);
    if (this.lastAttempt.size <= ACCOUNT_PHOTO_ATTEMPT_MAP_MAX) return;
    for (const [id, time] of this.lastAttempt) {
      if (this.lastAttempt.size <= ACCOUNT_PHOTO_ATTEMPT_MAP_MAX && at - time < ACCOUNT_PHOTO_MIN_INTERVAL_MS) break;
      this.lastAttempt.delete(id); // expired entries first (oldest first), then the oldest to respect the bound
    }
  }

  private requireStore(): ObjectStore {
    if (this.store === null) throw new AppError('service_unavailable');
    return this.store;
  }

  private unavailable(error: unknown): AppError {
    if (isObjectStoreError(error)) this.logger.error({ ...errorLogFields(error) }, 'account photo storage failed');
    else this.logger.error({ ...errorLogFields(error) }, 'account photo storage failed unexpectedly');
    return new AppError('service_unavailable');
  }

  /** Best effort: an orphan object is harmless (never referenced, never served) and is logged, not raised. */
  private async discard(store: ObjectStore, key: string): Promise<void> {
    try {
      await store.delete(key);
    } catch (error) {
      this.logger.warn({ ...errorLogFields(error) }, 'account photo object could not be deleted');
    }
  }
}

function decodeUpload(dataBase64: string): Uint8Array {
  if (dataBase64.length % 4 !== 0 || !BASE64.test(dataBase64)) {
    throw new AppError('validation_failed', { details: { issues: [{ path: 'dataBase64', code: 'photo_unreadable' }] } });
  }
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.byteLength > PHOTO_UPLOAD_MAX_BYTES) {
    throw new AppError('validation_failed', { details: { issues: [{ path: 'dataBase64', code: 'photo_too_large' }] } });
  }
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
