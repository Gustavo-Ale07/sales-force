import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, orderDeliveryLabel, type OrderStatus } from '../src/index.js';

describe('orderDeliveryLabel (SNK-7 D-L)', () => {
  it.each([
    ['queued', null, 'Enviando ao Sankhya…'],
    ['unknown', null, 'Verificando envio…'],
    ['unknown', 5000, 'Enviado, aguardando confirmação'],
    ['sent', 5000, 'Enviado ao Sankhya'],
    ['rejected', null, 'Falha no envio'],
    ['rejected', 5000, 'Falha no envio'],
  ] as [OrderStatus, number | null, string][])('%s with number %s -> %s', (status, erpNumber, label) => {
    expect(orderDeliveryLabel({ status, erpNumber })).toBe(label);
  });

  it('D-AA: a delivery pending for more than 2 minutes reads "Aguardando envio", never "fila"', () => {
    const updatedAt = '2026-11-05T15:00:00.000Z';
    const at = (seconds: number) => Date.parse(updatedAt) + seconds * 1000;
    expect(orderDeliveryLabel({ status: 'queued', erpNumber: null, updatedAt, now: at(119) })).toBe('Enviando ao Sankhya…');
    expect(orderDeliveryLabel({ status: 'queued', erpNumber: null, updatedAt, now: at(121) })).toBe(
      'Aguardando envio — será reenviado automaticamente',
    );
    expect(orderDeliveryLabel({ status: 'queued', erpNumber: null, updatedAt, now: at(900) })).not.toMatch(/fila/i);
  });

  it('returns null outside the delivery path', () => {
    for (const status of ORDER_STATUSES) {
      if (['queued', 'unknown', 'sent', 'rejected'].includes(status)) continue;
      expect(orderDeliveryLabel({ status, erpNumber: null })).toBeNull();
    }
  });
});
