import { createHash } from 'node:crypto';
import { type SankhyaGatewayError } from '../errors.js';
import { assertUserPhotoRequest } from '../write/profile-photo-wire.js';
import type { UserPhotoWriteRequest } from '../write/profile-photo-contract.js';

/** Scripted outcome of one fake `TSIUSU.FOTO` write (consumed in order, default `ok`). */
export type FakeUserPhotoOutcome = { readonly kind: 'ok' } | { readonly kind: 'error'; readonly error: SankhyaGatewayError };

/**
 * In-memory stand-in for `TSIUSU.FOTO`. Like the ERP, the write sets a STATE: the user holds ONE photo, so a repeated write
 * of the same version never adds a second one (`photos.size` stays); `writes` counts calls so tests can prove how many
 * times the worker really sent.
 */
export class FakeUserPhotoBook {
  /** userCode -> sha256 of the stored image. */
  readonly photos = new Map<number, string>();
  readonly writes: { readonly userCode: number; readonly idempotencyKey: string }[] = [];
  readonly #script: FakeUserPhotoOutcome[] = [];

  script(...outcomes: FakeUserPhotoOutcome[]): void {
    this.#script.push(...outcomes);
  }

  write(request: UserPhotoWriteRequest): void {
    assertUserPhotoRequest(request);
    this.writes.push({ userCode: request.userCode, idempotencyKey: request.idempotencyKey });
    const outcome = this.#script.shift() ?? { kind: 'ok' };
    if (outcome.kind === 'error') throw outcome.error;
    this.photos.set(request.userCode, createHash('sha256').update(request.image).digest('hex'));
  }
}
