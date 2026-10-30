import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, orderDeliveryLabel, type OrderStatus } from '../src/index.js';

describe('orderDeliveryLabel (SNK-7 D-L)', () => {
  it.each([
    ['queued', null, 'Na fila para o Sankhya'],
    ['unknown', null, 'Envio em verificação'],
    ['unknown', 5000, 'Enviado, aguardando confirmação'],
    ['sent', 5000, 'Enviado ao Sankhya'],
    ['rejected', null, 'Falha no envio'],
    ['rejected', 5000, 'Falha no envio'],
  ] as [OrderStatus, number | null, string][])('%s with number %s -> %s', (status, erpNumber, label) => {
    expect(orderDeliveryLabel({ status, erpNumber })).toBe(label);
  });

  it('returns null outside the delivery path', () => {
    for (const status of ORDER_STATUSES) {
      if (['queued', 'unknown', 'sent', 'rejected'].includes(status)) continue;
      expect(orderDeliveryLabel({ status, erpNumber: null })).toBeNull();
    }
  });
});
