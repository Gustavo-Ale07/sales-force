import { createHash } from 'node:crypto';

/**
 * Fingerprint of the contact data the app can edit offline (phone and e-mail, as mirrored from the ERP). The app keeps the value it
 * saw when the seller started editing and sends it back as `baseContactVersion`; a different value now means the customer changed in
 * the ERP in the meantime. Digits-only phone and lower-case e-mail, so formatting never raises a false conflict.
 */
export function contactVersionOf(phone: string | null | undefined, email: string | null | undefined): string {
  const normalizedPhone = (phone ?? '').replace(/\D/g, '');
  const normalizedEmail = (email ?? '').trim().toLowerCase();
  return createHash('sha256').update(JSON.stringify(['c1', normalizedPhone, normalizedEmail])).digest('hex').slice(0, 16);
}
