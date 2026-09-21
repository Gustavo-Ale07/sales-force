import { userInfo } from 'node:os';

const OPERATOR_PATTERN = /^[A-Za-z0-9._@ -]{1,64}$/;

/**
 * Who ran an operator script, for the audit trail (RF-IAM-1, security model §13): the explicit
 * `OPERATOR` variable when set (validated: it is written to the audit detail), otherwise the
 * operating-system user prefixed `os:`. Never a secret; the value is attributable, not verified
 * (a shell user can set it), which is why the OS user is also the fallback.
 */
export function operatorIdentity(
  env: Readonly<Record<string, string | undefined>>,
  osUser: () => string = () => userInfo().username,
): string {
  const explicit = env['OPERATOR']?.trim();
  if (explicit !== undefined && explicit !== '') {
    if (!OPERATOR_PATTERN.test(explicit)) {
      throw new Error('OPERATOR: must be 1-64 characters of letters, digits, space and . _ @ - (it is recorded in the audit trail).');
    }
    return explicit;
  }
  let name: string;
  try {
    name = osUser();
  } catch {
    name = 'unknown';
  }
  return `os:${name.replace(/[^A-Za-z0-9._@-]/g, '_').slice(0, 60) || 'unknown'}`;
}
