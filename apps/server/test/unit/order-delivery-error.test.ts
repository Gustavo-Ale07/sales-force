import { describe, expect, it } from 'vitest';
import { erpDeliveryOf } from '../../src/orders/order.mapper.js';

describe('erpDeliveryOf (K3: only the class and the stable code leave the server)', () => {
  it('extracts the code before the first colon of a rejected order', () => {
    expect(erpDeliveryOf('rejected', 'validation', 'environment_mismatch: The order is not eligible for the target ERP environment.')).toEqual({
      errorClass: 'validation',
      errorCode: 'environment_mismatch',
    });
  });

  it('never returns the stored text, even when the head is not a code', () => {
    const out = erpDeliveryOf('rejected', 'validation', 'Customer João Silva refused: secret');
    expect(out).toEqual({ errorClass: 'validation', errorCode: null });
    expect(JSON.stringify(out)).not.toContain('João');
  });

  it('is null for orders that are not rejected', () => {
    expect(erpDeliveryOf('sent', 'validation', 'x: y')).toBeNull();
    expect(erpDeliveryOf('queued', null, null)).toBeNull();
  });

  it('is null when there is no delivery row', () => {
    expect(erpDeliveryOf('rejected', null, null)).toBeNull();
  });
});
