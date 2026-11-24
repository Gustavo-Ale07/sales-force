/**
 * Profile photo write contract (owner decision 2026-11-24; spike S1.8). The Sales Force keeps only the display copy of the
 * photo (`account_photo`); the ERP copy is `TSIUSU.FOTO` of the user linked to the account (VALIDATED field, S1.8).
 *
 * Idempotency (SNK-4): the operation is a STATE write ("the photo of user X is this image"), never an insert: repeating
 * it with the same bytes leaves the ERP in the same state and creates no row. The worker also deduplicates the command
 * itself by `idempotencyKey` = `photo:<accountId>:<photoVersion>` (unique outbox origin id), so a version is sent once.
 */
export interface UserPhotoWriteRequest {
  /** `TSIUSU.CODUSU`, resolved by the worker from the account's seller link (CFG-2); never guessed here. */
  readonly userCode: number;
  /** The image as stored in `TSIUSU.FOTO`: JPEG bytes (the ERP holds PNG and JPEG; the Force always sends JPEG). */
  readonly image: Uint8Array;
  /** `photo:<accountId>:<photoVersion>`; identical on every retry. Never sent to the ERP. */
  readonly idempotencyKey: string;
}

export interface UserPhotoCallOptions {
  readonly signal?: AbortSignal;
}

export interface SankhyaProfilePhotoPort {
  /** Refuses with `NotImplementedError` and no network call unless the profile-photo switch is open (Sandbox only). */
  writeUserPhoto(request: UserPhotoWriteRequest, options?: UserPhotoCallOptions): Promise<void>;
}

export const USER_PHOTO_MAX_BYTES = 512 * 1024;

export const PROFILE_PHOTO_WRITE_NOT_ENABLED_MESSAGE =
  'ERP profile photo writes are not enabled for this gateway: the Sandbox write test is pending. NEEDS VALIDATION (spike S1.8; SNK-4, SNK-6). ' +
  'They require SANKHYA_PROFILE_PHOTO_WRITE_ENABLED=true on staging against the Sandbox.';
