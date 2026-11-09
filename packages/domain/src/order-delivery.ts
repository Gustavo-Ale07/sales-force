import type { OrderStatus } from './status.js';

/** D-AA: a delivery still pending after this long is shown as "Aguardando envio" (the worker retries by itself). */
export const DELIVERY_OVERDUE_MS = 2 * 60 * 1000;

/** True when a `queued` order has not moved for more than DELIVERY_OVERDUE_MS. Without timestamps it is never overdue. */
export function isDeliveryOverdue(order: { readonly updatedAt?: string | number | Date; readonly now?: number }): boolean {
  if (order.updatedAt === undefined || order.now === undefined) return false;
  const since = new Date(order.updatedAt).getTime();
  return Number.isFinite(since) && order.now - since > DELIVERY_OVERDUE_MS;
}

/**
 * User-facing delivery state of an order towards the ERP (SNK-7 D-L, pt-BR). Pure: it only maps what the
 * order row already carries. Statuses outside the delivery path return `null` (the UI shows its own label).
 *
 * `unknown` with an ERP number means "included, waiting for confirmation" (D-4); without a number it means
 * the send result is being verified by origin id (SNK-4).
 */
export function orderDeliveryLabel(order: {
  readonly status: OrderStatus;
  readonly erpNumber: number | null;
  /** When the order last changed (entered `queued`); with `now` it tells a slow delivery from a normal one (D-AA). */
  readonly updatedAt?: string | number | Date;
  readonly now?: number;
}): string | null {
  switch (order.status) {
    case 'queued':
      return isDeliveryOverdue(order) ? 'Aguardando envio — será reenviado automaticamente' : 'Enviando ao Sankhya…';
    case 'unknown':
      return order.erpNumber === null ? 'Verificando envio…' : 'Verificando envio…';
    case 'sent':
      return 'Enviado ao Sankhya';
    case 'rejected':
      return 'Falha no envio';
    default:
      return null;
  }
}
