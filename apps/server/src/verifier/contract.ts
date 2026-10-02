import { z } from 'zod';

/**
 * Wire contract between the Force API and the internal identity verifier (STACK-2 option C). Local to the
 * verifier module on purpose: nothing here is published to web/mobile and `packages/contracts` is untouched.
 *
 * Status: STRUCTURE ONLY. No Sankhya adapter exists (the login mechanism is unproven, BLOCKED_EXTERNAL_SECRET),
 * so the only response the running service can produce is a denial. `verifiedIdentitySchema` documents the
 * minimal shape a future live adapter may return; nothing in this module can construct it.
 */

/** Sent once per login attempt, in the body only (never URL, header or log context). */
export const verifyRequestSchema = z
  .object({
    login: z.string().min(1).max(256),
    password: z.string().min(1).max(1024),
  })
  .strict();
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

/** Minimal identity a live adapter may return: no Sankhya token, no ERP data, never cost or margin (P-20). */
export const verifiedIdentitySchema = z
  .object({
    ok: z.literal(true),
    codusu: z.number().int().positive(),
    codvend: z.number().int().positive().nullable(),
    active: z.boolean(),
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
 * The port behind the endpoint. The disabled implementation (the only one that exists) always denies.
 * A live implementation is intentionally absent; adding one is a separate, reviewed change gated by the
 * Sankhya spike (SNK-3, V-11) and a security review.
 */
export interface IdentityVerification {
  verify(request: VerifyRequest, signal: AbortSignal): Promise<VerifiedIdentity | VerifyDenial>;
}

export const DENIAL: VerifyDenial = Object.freeze({ ok: false, code: 'denied' });

export const disabledVerification: IdentityVerification = {
  verify: () => Promise.resolve(DENIAL),
};
