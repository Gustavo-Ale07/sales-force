import { z } from 'zod';

/**
 * Wire contract between the Force API and the internal identity verifier (STACK-2 option C). Local to the
 * verifier module on purpose: nothing here is published to web/mobile and `packages/contracts` is untouched.
 *
 * `verifiedIdentitySchema` is the minimal identity the live adapter returns (Sankhya Sandbox `MobileLoginSP.login` answers
 * `idusu` in the same response that authenticated the password). Disabled mode can only deny.
 */

/** Sent once per login attempt, in the body only (never URL, header or log context). */
export const verifyRequestSchema = z
  .object({
    login: z.string().min(1).max(256),
    password: z.string().min(1).max(1024),
  })
  .strict();
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

/** Stable directory id: the decimal Sankhya user code decoded from `idusu` (see decodeSankhyaUserId); 0 is valid. Not documented as CODUSU. */
export const EXTERNAL_USER_ID_PATTERN = /^[0-9]{1,18}$/;

/** Minimal identity a live adapter may return: no Sankhya token, no ERP data, never cost or margin (P-20). */
export const verifiedIdentitySchema = z
  .object({
    ok: z.literal(true),
    externalUserId: z.string().regex(EXTERNAL_USER_ID_PATTERN),
    /** The login text that was verified (as typed, trimmed). Not a display name: none is returned by the login. */
    username: z.string().min(1).max(256),
    active: z.literal(true),
    verifiedAt: z.iso.datetime(),
  })
  .strict();

/**
 * Uniform refusal. Wrong password, unknown user, disabled verifier and reconciliation failures all look the
 * same to the caller (no oracle); the specific reason lives only in the verifier log, without credentials.
 */
export const verifyDenialSchema = z.object({ ok: z.literal(false), code: z.literal('denied') }).strict();

/** Fail-closed infrastructure outcomes that are not a credential verdict. */
export const verifierErrorSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(['unauthorized', 'bad_request', 'payload_too_large', 'rate_limited', 'unavailable', 'not_found']),
  })
  .strict();

export const verifyResponseSchema = z.union([verifiedIdentitySchema, verifyDenialSchema, verifierErrorSchema]);
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;
export type VerifyDenial = z.infer<typeof verifyDenialSchema>;
export type VerifiedIdentity = z.infer<typeof verifiedIdentitySchema>;

/**
 * The port behind the endpoint: the disabled implementation always denies; the live one is `SankhyaLoginVerification`.
 */
export interface IdentityVerification {
  verify(request: VerifyRequest, signal: AbortSignal): Promise<VerifiedIdentity | VerifyDenial>;
}

export const DENIAL: VerifyDenial = Object.freeze({ ok: false, code: 'denied' });

export const disabledVerification: IdentityVerification = {
  verify: () => Promise.resolve(DENIAL),
};
