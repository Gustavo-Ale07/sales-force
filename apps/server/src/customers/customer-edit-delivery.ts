/**
 * The seam between a customer edit and the ERP (D-AP). Edit delivery is NOT approved: the partner write port has no update
 * operation (`updatePartner` stays refused) and the owner has not authorized adding one. This file is the one place that decision
 * will plug into; nothing calls the gateway from here and the refusing implementation below is what every environment gets
 * until the owner approves.
 *
 * What an approved implementation must do (so the owner can review the seam, not guess at it):
 *  - run in the worker only (Sankhya credentials), claiming `customer_update` outbox rows (STACK-6, SNK-1);
 *  - write ONLY the fields of the allow-list below, never document, name, seller, type or any credit field;
 *  - verify the customer by its origin before and after the write (SNK-4) and classify failures with `decideFailure`;
 *  - treat `validation` and `permanent` as definitive and never retry them.
 */
export const EDITABLE_CUSTOMER_FIELDS = ['phone', 'email', 'notes', 'contacts', 'addresses'] as const;
export type EditableCustomerField = (typeof EDITABLE_CUSTOMER_FIELDS)[number];

/** Whether the owner approved delivering edits to the ERP. Flip only together with a real delivery implementation and its Sandbox script. */
export const CUSTOMER_EDIT_DELIVERY_APPROVED: boolean = false;

export type CustomerEditDeliveryResult = { readonly kind: 'refused'; readonly reason: 'edit_delivery_not_approved' };

export interface CustomerEditDelivery {
  /** True only when the owner approved edit delivery. */
  readonly approved: boolean;
  /** Names of the changed fields only; the values never reach this seam while it refuses. */
  deliver(customerCode: number, fields: readonly EditableCustomerField[]): Promise<CustomerEditDeliveryResult>;
}

/** The only implementation until the owner approves an update operation on the partner write port. */
export class RefusingCustomerEditDelivery implements CustomerEditDelivery {
  readonly approved = false;
  deliver(): Promise<CustomerEditDeliveryResult> {
    return Promise.resolve({ kind: 'refused', reason: 'edit_delivery_not_approved' });
  }
}
