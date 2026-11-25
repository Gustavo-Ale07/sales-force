/**
 * The four states a customer registration or edit shows to the user, the same words the order uses (owner 2026-11-25), so the site and
 * the app print one text. `draft` ("Salvo") exists only on the device; the server answers the other three.
 *
 * Only a DEFINITIVE refusal by the ERP is "Precisa de correção". Anything still in delivery, a retry, a lost answer or a record parked for
 * a person is "Aguardando envio": the seller could not fix those, and the ERP may already hold the record (SNK-4).
 */
export const CUSTOMER_STATES = ['draft', 'awaiting_send', 'sent', 'needs_correction'] as const;
export type CustomerStateName = (typeof CUSTOMER_STATES)[number];

export const CUSTOMER_STATE_LABELS: Readonly<Record<CustomerStateName, string>> = Object.freeze({
  draft: 'Salvo',
  awaiting_send: 'Aguardando envio',
  sent: 'Enviado ao Sankhya',
  needs_correction: 'Precisa de correção',
});

export function customerStateLabel(state: CustomerStateName): string {
  return CUSTOMER_STATE_LABELS[state];
}

/** Delivery status of the outbox command -> the state shown. Never returns `draft`. */
export function customerStateOfDelivery(status: string): Exclude<CustomerStateName, 'draft'> {
  if (status === 'confirmed') return 'sent';
  if (status === 'rejected') return 'needs_correction';
  return 'awaiting_send';
}
