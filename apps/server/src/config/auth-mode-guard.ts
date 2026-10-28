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
