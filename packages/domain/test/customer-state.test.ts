import { describe, expect, it } from 'vitest';
import { CUSTOMER_STATE_LABELS, customerStateLabel, customerStateOfDelivery } from '../src/index.js';

describe('customer state (same four states as the order; one text for site and app)', () => {
  it('has the owner wording', () => {
    expect(CUSTOMER_STATE_LABELS).toEqual({
      draft: 'Salvo',
      awaiting_send: 'Aguardando envio',
      sent: 'Enviado ao Sankhya',
      needs_correction: 'Precisa de correção',
    });
    expect(customerStateLabel('needs_correction')).toBe('Precisa de correção');
  });

  it('maps the delivery status to the state: only a definitive refusal needs correction', () => {
    expect(customerStateOfDelivery('pending')).toBe('awaiting_send');
    expect(customerStateOfDelivery('processing')).toBe('awaiting_send');
    expect(customerStateOfDelivery('unknown')).toBe('awaiting_send');
    expect(customerStateOfDelivery('confirmed')).toBe('sent');
    expect(customerStateOfDelivery('rejected')).toBe('needs_correction');
  });

  it('an unrecognized status never becomes a refusal', () => {
    expect(customerStateOfDelivery('anything')).toBe('awaiting_send');
  });
});
