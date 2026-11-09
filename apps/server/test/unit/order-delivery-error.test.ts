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

  it('exposes the ERP refusal text, and only for erp_refused_order', () => {
    expect(erpDeliveryOf('rejected', 'validation', 'erp_refused_order: The ERP refused the order: Produto 123 sem preço na tabela.')).toEqual({
      errorClass: 'validation',
      errorCode: 'erp_refused_order',
      message: 'Produto 123 sem preço na tabela',
    });
    const long = erpDeliveryOf('rejected', 'validation', `erp_refused_order: The ERP refused the order: ${'x'.repeat(400)}.`);
    expect(long?.message).toHaveLength(200);
    expect(erpDeliveryOf('rejected', 'validation', 'erp_refused_order: The ERP refused the order: no message.')).toEqual({
      errorClass: 'validation',
      errorCode: 'erp_refused_order',
    });
    // Any other code keeps the old rule: the stored text never leaves the server.
    expect(erpDeliveryOf('rejected', 'validation', 'environment_mismatch: texto interno')).not.toHaveProperty('message');
  });

  it('is null for orders that are not rejected', () => {
    expect(erpDeliveryOf('sent', 'validation', 'x: y')).toBeNull();
    expect(erpDeliveryOf('queued', null, null)).toBeNull();
  });

  it('is null when there is no delivery row', () => {
    expect(erpDeliveryOf('rejected', null, null)).toBeNull();
  });
});
