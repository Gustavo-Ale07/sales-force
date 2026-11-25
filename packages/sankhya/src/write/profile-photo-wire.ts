import { SankhyaGatewayError, classifyHttpFailure } from '../errors.js';
import { USER_PHOTO_MAX_BYTES, type UserPhotoWriteRequest } from './profile-photo-contract.js';

/**
 * Mapping module of the user photo write (`TSIUSU.FOTO`, spike S1.8).
 *
 * VALIDATED (owner Sandbox probe, 2026-11-24): the column is `TSIUSU.FOTO`, a BLOB; the ERP holds PNG and JPEG images.
 * NEEDS VALIDATION (to be corrected HERE, in one place, by the Sandbox write test; nothing below was observed):
 *   - the SERVICE (`CRUDServiceProvider.saveRecord`, entity `Usuario`) and the request/response SHAPE: same assumption as the
 *     partner write, from the public developer documentation; an alternative is `DatasetSP.save` on `TSIUSU`;
 *   - VALIDATED (owner SELECT, 2026-11-25, spike §9.66): the BLOB travels by the binary path (sessionUpload.mge multipart upload, then
 *     saveRecord with `$file.session.key{...}`); base64 and hex text in the JSON were stored as text and are not used;
 *   - whether the API user may update `TSIUSU` at all, and any size limit of the column;
 *   - the text and code of a refusal.
 */
export const USER_SAVE_RECORD_PATH = '/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.saveRecord&outputType=json';
export const USER_SAVE_SERVICE = 'CRUDServiceProvider.saveRecord';
export const USER_ROOT_ENTITY = 'Usuario';
/** Name of the session slot that links the upload to the save (technique of the Sankhya community, NEEDS VALIDATION on the gateway). */
export const USER_PHOTO_SESSION_KEY = 'Usuario_FOTO';
export const USER_PHOTO_UPLOAD_PATH = `/gateway/v1/mge/sessionUpload.mge?sessionkey=${USER_PHOTO_SESSION_KEY}&fitem=S&salvar=S&useCache=N`;

function permanent(code: string, message: string): SankhyaGatewayError {
  return new SankhyaGatewayError('permanent', { code, message });
}

/** The ERP text is never in the message (it may echo data); a short copy rides in `cause` only for the operator probe. */
function refusal(code: string, message: string, parsed: Record<string, unknown>): SankhyaGatewayError {
  return new SankhyaGatewayError('permanent', { code, message, cause: new Error(String(parsed['statusMessage'] ?? '').slice(0, 200)) });
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Pre-send validation: a bad request leaves here, before any call. */
export function assertUserPhotoRequest(request: UserPhotoWriteRequest): void {
  if (!Number.isInteger(request.userCode) || request.userCode < 0) {
    throw permanent('user_photo_invalid_user', 'The ERP user code is not a valid integer. Nothing was sent.');
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
          // A REFERENCE to the file uploaded to the session (see `buildUserPhotoUpload`), never the image inside the JSON: base64 and hex
          // text were both stored AS TEXT by the ERP (observed 2026-11-25).
          localFields: { FOTO: { $: '$file.session.key{' + USER_PHOTO_SESSION_KEY + '}' } },
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
    throw refusal('erp_refused_user_photo', 'The ERP refused the user photo.', parsed);
  }
}

const MULTIPART_BOUNDARY = '----SalesForceUserPhoto7d3f1a';

/** Step 1 of the binary path: the JPEG as the file part `arquivo` of a multipart body (the BYTES travel, not text). Deterministic. */
export function buildUserPhotoUpload(request: UserPhotoWriteRequest): { readonly contentType: string; readonly body: Uint8Array } {
  assertUserPhotoRequest(request);
  const head = Buffer.from(
    `--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="arquivo"; filename="foto.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    'latin1',
  );
  const tail = Buffer.from(`\r\n--${MULTIPART_BOUNDARY}--\r\n`, 'latin1');
  const image = Buffer.from(request.image);
  if (image.includes(Buffer.from(MULTIPART_BOUNDARY, 'latin1'))) throw permanent('user_photo_invalid_image', 'The photo cannot be wrapped for upload. Nothing was sent.');
  return { contentType: `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`, body: new Uint8Array(Buffer.concat([head, image, tail])) };
}

/** The upload answered: HTTP 200 and not an explicit error envelope. The response body is not documented (NEEDS VALIDATION). */
export function parseUserPhotoUploadResponse(status: number, body: string, retryAfterMs?: number): void {
  if (status !== 200) throw classifyHttpFailure(status, 'ERP user photo upload', retryAfterMs);
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && String(parsed['status']) === '0') {
      throw refusal('erp_refused_user_photo_upload', 'The ERP refused the user photo upload.', parsed);
    }
  } catch (error) {
    if (error instanceof SankhyaGatewayError) throw error;
    // a non-JSON 200 body is accepted: the save step proves the file arrived
  }
}
