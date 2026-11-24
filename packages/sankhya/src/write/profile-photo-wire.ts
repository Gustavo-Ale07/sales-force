import { SankhyaGatewayError, classifyHttpFailure } from '../errors.js';
import { USER_PHOTO_MAX_BYTES, type UserPhotoWriteRequest } from './profile-photo-contract.js';

/**
 * Mapping module of the user photo write (`TSIUSU.FOTO`, spike S1.8).
 *
 * VALIDATED (owner Sandbox probe, 2026-11-24): the column is `TSIUSU.FOTO`, a BLOB; the ERP holds PNG and JPEG images.
 * NEEDS VALIDATION (to be corrected HERE, in one place, by the Sandbox write test; nothing below was observed):
 *   - the SERVICE (`CRUDServiceProvider.saveRecord`, entity `Usuario`) and the request/response SHAPE: same assumption as the
 *     partner write, from the public developer documentation; an alternative is `DatasetSP.save` on `TSIUSU`;
 *   - how a BLOB travels in the JSON (assumed: base64 text in `localFields.FOTO.$`);
 *   - whether the API user may update `TSIUSU` at all, and any size limit of the column;
 *   - the text and code of a refusal.
 */
export const USER_SAVE_RECORD_PATH = '/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.saveRecord&outputType=json';
export const USER_SAVE_SERVICE = 'CRUDServiceProvider.saveRecord';
export const USER_ROOT_ENTITY = 'Usuario';

function permanent(code: string, message: string): SankhyaGatewayError {
  return new SankhyaGatewayError('permanent', { code, message });
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Pre-send validation: a bad request leaves here, before any call. */
export function assertUserPhotoRequest(request: UserPhotoWriteRequest): void {
  if (!Number.isInteger(request.userCode) || request.userCode < 1) {
    throw permanent('user_photo_invalid_user', 'The ERP user code is not a positive integer. Nothing was sent.');
  }
  if (!isJpeg(request.image)) throw permanent('user_photo_invalid_image', 'The photo is not a JPEG image. Nothing was sent.');
  if (request.image.byteLength > USER_PHOTO_MAX_BYTES) {
    throw permanent('user_photo_too_large', 'The photo is larger than the limit of the integration. Nothing was sent.');
  }
}

/** Pure and deterministic: same request, same payload. */
export function buildUserPhotoRequestText(request: UserPhotoWriteRequest): string {
  assertUserPhotoRequest(request);
  return JSON.stringify({
    serviceName: USER_SAVE_SERVICE,
    requestBody: {
      dataSet: {
        rootEntity: USER_ROOT_ENTITY,
        includePresentationFields: 'N',
        dataRow: {
          key: { CODUSU: { $: String(request.userCode) } },
          localFields: { FOTO: { $: Buffer.from(request.image).toString('base64') } },
        },
        entity: { fieldset: { list: 'CODUSU' } },
      },
    },
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/** Success = HTTP 200 + `status` "1". A refusal is DEFINITIVE (`permanent`); the ERP text is never copied (it may echo data). */
export function parseUserPhotoResponse(status: number, body: string, retryAfterMs?: number): void {
  if (status !== 200) throw classifyHttpFailure(status, 'ERP user photo write', retryAfterMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'saveRecord: the response was not JSON.', cause });
  }
  if (!isRecord(parsed)) {
    throw new SankhyaGatewayError('temporary', { code: 'invalid_gateway_response', message: 'saveRecord: unexpected response shape.' });
  }
  if (String(parsed['status']) !== '1') {
    throw permanent('erp_refused_user_photo', 'The ERP refused the user photo (NEEDS VALIDATION: the refusal text was never observed).');
  }
}
