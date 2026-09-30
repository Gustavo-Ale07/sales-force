import { erpSubmissionBlock, type ErpBinding, type ErpSubmissionTarget } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';

/**
 * Server-side gate for the day an order is queued or an outbox row is created/claimed (SNK-4, SNK-6,
 * P-15). Nothing calls it yet because ERP submission is disabled; the future writer MUST call it at
 * every such place, on top of the database gate (`sales_order_erp_eligibility_chk` and the
 * `integration_outbox_order_gate` trigger, which refuse legacy/fake/unbound orders whatever the code does).
 * The binding is read from the stored row, never from a request.
 */
export function assertEligibleForErpSubmission(order: ErpBinding, target: ErpSubmissionTarget): void {
  const block = erpSubmissionBlock(order, target);
  if (block === null) return;
  throw new AppError('conflict', {
    message: 'Este pedido não é elegível para envio ao ERP neste ambiente.',
    details: { reason: block },
  });
}
