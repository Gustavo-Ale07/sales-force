import { describe, expect, it } from 'vitest';
import { deliveryErrorText } from '../src/index.js';

describe('deliveryErrorText (why "Precisa de correção", one text for site and app)', () => {
  it('has no text without a delivery error', () => {
    expect(deliveryErrorText(null)).toBeNull();
    expect(deliveryErrorText(undefined)).toBeNull();
  });

  it('maps a known code', () => {
    expect(deliveryErrorText({ errorClass: 'validation', errorCode: 'missing_freight_type' })).toBe('Frete não informado');
    expect(deliveryErrorText({ errorClass: 'validation', errorCode: 'no_price' })).toBe('Item sem preço');
  });

  it('shows the ERP refusal text when there is one', () => {
    expect(deliveryErrorText({ errorClass: 'permanent', errorCode: 'erp_refused_order', message: 'Cliente bloqueado' })).toBe('O Sankhya recusou o pedido: Cliente bloqueado');
    expect(deliveryErrorText({ errorClass: 'permanent', errorCode: 'erp_refused_order' })).toBe('O Sankhya recusou o pedido');
  });

  it('falls back by class, then to the generic failure', () => {
    expect(deliveryErrorText({ errorClass: 'validation', errorCode: 'zzz' })).toBe('O Sankhya ou o Force recusou os dados do pedido');
    expect(deliveryErrorText({ errorClass: 'timeout', errorCode: 'zzz' })).toBe('Falha no envio (timeout / zzz)');
    expect(deliveryErrorText({ errorClass: 'timeout', errorCode: null })).toBe('Falha no envio (timeout)');
  });
});
