import sharp from 'sharp';

/**
 * Profile photo rendition. The upload is NEVER stored: it is decoded, cropped to a square, downsized and re-encoded
 * as WebP, so every byte that is stored and served was produced here (no EXIF, no GPS, no embedded profile/comment,
 * no polyglot payload). sharp stays behind this module, like the product thumbnails.
 */
export type AccountPhotoErrorCode = 'type_not_allowed' | 'content_mismatch' | 'too_large' | 'unreadable' | 'crop_invalid' | 'too_small' | 'busy' | 'timeout';

export class AccountPhotoError extends Error {
  readonly code: AccountPhotoErrorCode;

  constructor(code: AccountPhotoErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AccountPhotoError';
    this.code = code;
  }
}

export function isAccountPhotoError(value: unknown): value is AccountPhotoError {
  return value instanceof AccountPhotoError;
}

export type PhotoUploadType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PhotoCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderedAccountPhoto {
  readonly bytes: Uint8Array;
  readonly contentType: 'image/webp';
  readonly sizePx: number;
}

export const ACCOUNT_PHOTO_MAX_SIDE = 512;
export const ACCOUNT_PHOTO_MIN_SIDE = 64;
export const ACCOUNT_PHOTO_WEBP_QUALITY = 85;
/** Decoded-pixel ceiling (decompression-bomb guard), same as the product thumbnails. */
export const ACCOUNT_PHOTO_MAX_INPUT_PIXELS = 32_000_000;
/** Largest stored rendition: a 512 px square WebP is a few tens of KiB; more is a defect. */
export const ACCOUNT_PHOTO_MAX_OUTPUT_BYTES = 512 * 1024;

/** The file type by its first bytes (never by the declared type or a file name). */
export function sniffPhotoType(bytes: Uint8Array): PhotoUploadType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

const FORMAT_OF: Readonly<Record<PhotoUploadType, string>> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

let configured = false;
function configureSharpOnce(): void {
  if (configured) return;
  configured = true;
  sharp.cache(false);
  sharp.concurrency(1);
}

/** Renders allowed to WAIT behind the running one; more are refused at once (`busy`) instead of piling up memory. */
export const ACCOUNT_PHOTO_MAX_QUEUED = 8;
/** A render (queue wait included) that takes longer is abandoned for the caller (`timeout`). */
export const ACCOUNT_PHOTO_RENDER_TIMEOUT_MS = 15_000;

/** One render at a time in the process: memory is bounded by one decoded raster. */
let tail: Promise<void> = Promise.resolve();
let inFlight = 0;
function runExclusive<T>(task: () => Promise<T>, limits: RenderLimits): Promise<T> {
  // inFlight counts the running render plus the waiting ones.
  if (inFlight > limits.maxQueued) throw new AccountPhotoError('busy', 'Too many photo renders are waiting.');
  inFlight += 1;
  const run = tail.then(task);
  // The chain always waits for the real end of the work (sharp cannot be cancelled), even when the caller gave up.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  void tail.then(() => {
    inFlight -= 1;
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AccountPhotoError('timeout', 'The photo render took too long.')), limits.timeoutMs);
  });
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

export interface RenderLimits {
  readonly maxQueued: number;
  readonly timeoutMs: number;
}
const DEFAULT_LIMITS: RenderLimits = { maxQueued: ACCOUNT_PHOTO_MAX_QUEUED, timeoutMs: ACCOUNT_PHOTO_RENDER_TIMEOUT_MS };

/** JPEG quality of the copy sent to the ERP (`TSIUSU.FOTO`, spike S1.8: the ERP holds PNG and JPEG, never WebP). */
export const ERP_PHOTO_JPEG_QUALITY = 88;

/**
 * The ERP copy of a stored rendition: the SAME picture (already cropped, 512 px, metadata-free) re-encoded as JPEG, flattened on
 * white because JPEG has no alpha. Input is always a rendition this module produced.
 */
export async function toErpJpeg(rendition: Uint8Array): Promise<Uint8Array> {
  configureSharpOnce();
  const out = await sharp(rendition, { limitInputPixels: ACCOUNT_PHOTO_MAX_INPUT_PIXELS })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: ERP_PHOTO_JPEG_QUALITY })
    .toBuffer();
  if (out.byteLength > ACCOUNT_PHOTO_MAX_OUTPUT_BYTES) throw new AccountPhotoError('unreadable', 'The ERP copy of the photo is too large.');
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export async function renderAccountPhoto(
  upload: Uint8Array,
  declared: PhotoUploadType,
  crop?: PhotoCrop,
  limits: RenderLimits = DEFAULT_LIMITS,
): Promise<RenderedAccountPhoto> {
  configureSharpOnce();
  const sniffed = sniffPhotoType(upload);
  if (sniffed === null) throw new AccountPhotoError('type_not_allowed', 'The file is not a JPEG, PNG or WebP image.');
  if (sniffed !== declared) throw new AccountPhotoError('content_mismatch', 'The file content does not match the declared type.');
  return await runExclusive(() => render(upload, sniffed, crop), limits);
}

async function render(upload: Uint8Array, type: PhotoUploadType, crop: PhotoCrop | undefined): Promise<RenderedAccountPhoto> {
  const source = Buffer.from(upload.buffer, upload.byteOffset, upload.byteLength);
  try {
    const probe = await sharp(source, { failOn: 'error', limitInputPixels: ACCOUNT_PHOTO_MAX_INPUT_PIXELS, animated: false }).metadata();
    if (probe.format !== FORMAT_OF[type]) throw new AccountPhotoError('content_mismatch', 'The file content does not match the declared type.');
    if ((probe.pages ?? 1) > 1) throw new AccountPhotoError('unreadable', 'Animated images are not accepted.');

    // Step 1: apply the EXIF orientation so the crop is expressed on what the user sees; metadata is not carried over.
    const upright = await sharp(source, { failOn: 'error', limitInputPixels: ACCOUNT_PHOTO_MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = upright.info;
    if (Math.min(width, height) < ACCOUNT_PHOTO_MIN_SIDE) throw new AccountPhotoError('too_small', 'The image is too small.');

    let region: { left: number; top: number; width: number; height: number };
    if (crop === undefined) {
      const side = Math.min(width, height);
      region = { left: Math.floor((width - side) / 2), top: Math.floor((height - side) / 2), width: side, height: side };
    } else {
      if (crop.x + crop.width > width || crop.y + crop.height > height || Math.min(crop.width, crop.height) < ACCOUNT_PHOTO_MIN_SIDE) {
        throw new AccountPhotoError('crop_invalid', 'The crop rectangle is outside the image or too small.');
      }
      // A non-square rectangle is squared from its centre.
      const side = Math.min(crop.width, crop.height);
      region = {
        left: crop.x + Math.floor((crop.width - side) / 2),
        top: crop.y + Math.floor((crop.height - side) / 2),
        width: side,
        height: side,
      };
    }
    const size = Math.min(ACCOUNT_PHOTO_MAX_SIDE, region.width);
    const { data } = await sharp(upright.data, { failOn: 'error' })
      .extract(region)
      .resize({ width: size, height: size, fit: 'cover' })
      .webp({ quality: ACCOUNT_PHOTO_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    if (data.length === 0 || data.length > ACCOUNT_PHOTO_MAX_OUTPUT_BYTES) throw new AccountPhotoError('unreadable', 'The rendition is out of bounds.');
    return { bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), contentType: 'image/webp', sizePx: size };
  } catch (error) {
    if (isAccountPhotoError(error)) throw error;
    const message = error instanceof Error ? error.message : '';
    if (/pixel limit|exceeds pixel/i.test(message)) throw new AccountPhotoError('too_large', 'The image has too many pixels.', { cause: error });
    throw new AccountPhotoError('unreadable', 'The image could not be decoded.', { cause: error });
  }
}
