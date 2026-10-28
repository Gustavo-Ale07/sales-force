/**
 * `AUTH_MODE=external` (PB-1, refines AUTH-5/AUTH-6): operational users (seller, manager) authenticate only through the
 * Sankhya verifier (STACK-2a); a local Argon2id password exists for `admin` and `technical` only. Tools that create
 * accounts outside the API (operator CLI, development seed) use this guard so they never leave a dormant local-password
 * operational account behind in an installation that runs that mode.
 */
export const OPERATIONAL_ROLES: readonly string[] = Object.freeze(['seller', 'manager']);

/** `null` = allowed; otherwise an actionable, value-free refusal. `authMode` is the installation's AUTH_MODE as seen by the tool. */
export function localPasswordRefusal(authMode: string | undefined, role: string): string | null {
  if (authMode !== 'external' || !OPERATIONAL_ROLES.includes(role)) return null;
  return (
    `--role ${role}: AUTH_MODE=external never gives an operational account a local password. ` +
    'Use "account create-external" (links the account to the Sankhya user, verified through the internal verifier) ' +
    'or let the first Sankhya sign-in provision it; "account create" is for admin and technical only.'
  );
}

/**
 * AUTH-9 (D1): a seller never has a local password, in any AUTH_MODE. The operator CLI refuses to create or change one;
 * the development seed creates demo sellers as data only (no usable hash) and development sessions open through the
 * session fixture, never through a fake verifier (AUTH-5).
 */
export function sellerPasswordRefusal(role: string): string | null {
  if (role !== 'seller') return null;
  return (
    'a seller never has a local password: the seller signs in with the Sankhya credentials through the verifier. ' +
    'Use "account create-external" to link the seller to the Sankhya user, or let the first Sankhya sign-in provision it.'
  );
}
