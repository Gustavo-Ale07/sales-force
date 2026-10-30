import type { OrderStatus } from './status.js';

/**
 * User-facing delivery state of an order towards the ERP (SNK-7 D-L, pt-BR). Pure: it only maps what the
 * order row already carries. Statuses outside the delivery path return `null` (the UI shows its own label).
 *
 * `unknown` with an ERP number means "included, waiting for confirmation" (D-4); without a number it means
 * the send result is being verified by origin id (SNK-4).
 */
export function orderDeliveryLabel(order: { readonly status: OrderStatus; readonly erpNumber: number | null }): string | null {
  switch (order.status) {
    case 'queued':
      return 'Na fila para o Sankhya';
    case 'unknown':
      return order.erpNumber === null ? 'Envio em verificação' : 'Enviado, aguardando confirmação';
    case 'sent':
      return 'Enviado ao Sankhya';
    case 'rejected':
      return 'Falha no envio';
    default:
      return null;
  }
}
