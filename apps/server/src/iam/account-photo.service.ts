import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PHOTO_UPLOAD_MAX_BYTES, type ProfilePhoto, type PutProfilePhotoRequest } from '@salesforce/contracts';
import { matchesIfNoneMatch } from '../catalog/product-image.js';
import { AppError } from '../http/app-error.js';
import { isObjectStoreError, type ObjectStore } from '../media/object-store.js';
import { isAccountPhotoError, renderAccountPhoto } from '../media/account-photo-renderer.js';
import { errorLogFields, type Logger } from '../observability/logger.js';
import { ACCOUNT_PHOTO_STORE, CLOCK, LOGGER, type Clock } from '../platform/tokens.js';
import { AccountPhotoRepository, type AccountPhotoRecord } from './account-photo.repository.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import type { CurrentUser } from './current-user.js';

/** A change is refused when the previous one is younger than this (the render is CPU work done in the request). */
export const ACCOUNT_PHOTO_MIN_INTERVAL_MS = 5_000;
/** Seconds a client may reuse the photo without revalidating (the URL is versioned, so a change is picked up through `photoVersion`). */
export const ACCOUNT_PHOTO_MAX_AGE_SECONDS = 3600;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type ServedAccountPhoto =
  | { readonly kind: 'not_modified'; readonly etag: string }
  | { readonly kind: 'image'; readonly etag: string; readonly contentType: string; readonly bytes: Uint8Array };

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
  constructor(
    @Inject(AccountPhotoRepository) private readonly photos: AccountPhotoRepository,
    @Inject(ACCOUNT_PHOTO_STORE) private readonly store: ObjectStore | null,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** The version to publish in the session, or null (no photo, or photo storage not configured). */
  async versionOf(accountId: string): Promise<string | null> {
    if (this.store === null) return null;
    const record = await this.photos.find(accountId);
    return record === null ? null : photoVersionOf(record);
  }

  async put(user: CurrentUser, body: PutProfilePhotoRequest): Promise<ProfilePhoto> {
    const store = this.requireStore();
    const upload = decodeUpload(body.dataBase64);
    const previous = await this.photos.find(user.accountId);
    const now = this.clock();
    if (previous !== null && now.getTime() - previous.updatedAt.getTime() < ACCOUNT_PHOTO_MIN_INTERVAL_MS) {
      throw new AppError('rate_limited', { retryAfterSeconds: Math.ceil(ACCOUNT_PHOTO_MIN_INTERVAL_MS / 1000) });
    }
    let rendered;
    try {
      rendered = await renderAccountPhoto(upload, body.contentType, body.crop);
    } catch (error) {
      if (isAccountPhotoError(error)) {
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

  /** Idempotent. */
  async remove(user: CurrentUser): Promise<void> {
    const store = this.requireStore();
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
    return { kind: 'image', etag, contentType: record.contentType, bytes };
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
