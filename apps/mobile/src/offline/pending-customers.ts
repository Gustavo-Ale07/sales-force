import {
  createPendingCustomer,
  discardPendingCustomer,
  listPendingCustomers,
  readExpectedDataset,
  retryPendingCustomer,
  type CreatePendingCustomerInput,
  type OfflineEnv,
  type PendingCustomerRecord,
  type SqlDatabase,
} from "@salesforce/mobile-db";
import type { CustomerListItem } from "../data/ports";

export { PENDING_CUSTOMER_MESSAGE } from "@salesforce/mobile-db";

/**
 * Customers created on this device that the ERP has not confirmed yet (F7). Creation is always local and durable; the
 * sync manager delivers them with the same idempotency key. The form is F8: this port is only the data surface.
 */
export interface PendingCustomersPort {
  create(request: CreatePendingCustomerInput["request"]): Promise<PendingCustomerRecord>;
  list(search?: string): Promise<PendingCustomerRecord[]>;
  /** Makes a waiting customer due now (a refused one cannot be resent as is). */
  resend(clientRequestId: string): Promise<void>;
  /** Local delete of a refused (or never sent) customer; a customer the server may already hold is never discarded. */
  discard(clientRequestId: string): Promise<void>;
}

export function createPendingCustomersPort(deps: {
  readonly db: SqlDatabase;
  readonly env: OfflineEnv;
  readonly ownerAccountId: string;
  /** Counters and listing refresh after a change; a sync can start when online. */
  readonly onChanged: () => void;
}): PendingCustomersPort {
  const { db, env, ownerAccountId, onChanged } = deps;
  return {
    async create(request) {
      const record = await createPendingCustomer(db, env, { ownerAccountId, request });
      onChanged();
      return record;
    },
    async list(search = "") {
      return listPendingCustomers(db, ownerAccountId, await readExpectedDataset(db), search);
    },
    async resend(clientRequestId) {
      await retryPendingCustomer(db, env, ownerAccountId, clientRequestId);
      onChanged();
    },
    async discard(clientRequestId) {
      await discardPendingCustomer(db, ownerAccountId, clientRequestId);
      onChanged();
    },
  };
}

/**
 * A pending customer as a list row. The code is the negative local one; document is masked; nothing about credit or
 * price table exists for it ("Limite de crédito a definir pelo financeiro" is shown on the sheet).
 */
export function toPendingListItem(record: PendingCustomerRecord): CustomerListItem {
  return {
    code: record.localCode,
    name: record.name,
    tradeName: record.request.tradeName,
    document: record.maskedDocument,
    active: true,
    blocked: false,
    sellerCode: null,
    sellerName: null,
    priceTableCode: null,
    pending: { clientRequestId: record.clientRequestId, state: record.state, rejectionReason: record.rejectionReason },
  };
}
