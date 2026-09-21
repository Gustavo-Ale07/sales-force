/**
 * Password policy for NEW passwords (RF-IAM-1, security model §3.1). Pure. Login never applies it
 * (an existing password is only verified). Not implemented yet: the breached-password range API
 * (HIBP) - a new third-party processor with an UNDECIDED unavailable-service behaviour; the local
 * list below is the interim control.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
const MIN_DISTINCT_CHARACTERS = 5;

export type PasswordViolation = 'too_short' | 'too_long' | 'too_repetitive' | 'too_common';

export const PASSWORD_VIOLATION_MESSAGES: Readonly<Record<PasswordViolation, string>> = {
  too_short: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  too_long: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
  too_repetitive: 'A senha é repetitiva demais. Use caracteres variados.',
  too_common: 'Esta senha é muito comum. Escolha outra.',
};

/**
 * Interim local list of very common passwords that are long enough to pass the length rule
 * (shorter ones are rejected by length anyway). Compared lowercase and without spaces.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789123',
  '111111111111',
  '000000000000',
  '123123123123',
  '123412341234',
  'abcdefghijkl',
  'abcd12345678',
  'qwertyuiop12',
  'qwertyuiopasdf',
  'qwertyuiop123',
  'qwertyuiopas',
  'asdfghjkl123',
  'asdfghjklqwe',
  'zxcvbnm12345',
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'p@ssw0rd1234',
  'p@ssword1234',
  'p@ssw0rd12345',
  'letmein12345',
  'welcome12345',
  'welcome123456',
  'iloveyou1234',
  'administrator',
  'admin1234567',
  'admin12345678',
  'administrador',
  'changeme1234',
  'changemenow1',
  'senha1234567',
  'senha12345678',
  'senhasenha123',
  'minhasenha123',
  'minhasenha1234',
  'mudar1234567',
  'mudarsenha123',
  'brasil123456',
  'brasil2024',
  'vendedor12345',
  'salesforce123',
  'salesforce1234',
  'sankhya12345',
  'sankhya123456',
]);

function normalizeForListLookup(password: string): string {
  return password.toLowerCase().replace(/\s+/g, '');
}

export function checkPasswordPolicy(password: string): PasswordViolation[] {
  const characters = [...password];
  const violations: PasswordViolation[] = [];
  if (characters.length < PASSWORD_MIN_LENGTH) violations.push('too_short');
  if (characters.length > PASSWORD_MAX_LENGTH) violations.push('too_long');
  if (characters.length >= PASSWORD_MIN_LENGTH && new Set(characters).size < MIN_DISTINCT_CHARACTERS) {
    violations.push('too_repetitive');
  }
  if (COMMON_PASSWORDS.has(normalizeForListLookup(password))) violations.push('too_common');
  return violations;
}

export function describePasswordViolations(violations: readonly PasswordViolation[]): string {
  return violations.map((violation) => PASSWORD_VIOLATION_MESSAGES[violation]).join(' ');
}
