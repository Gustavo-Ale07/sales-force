import {
  createPendingCustomer,
  CUSTOMER_CREATION_NOT_RELEASED,
  discardPendingCustomer,
  isCustomerCreationAvailable,
  listPendingCustomers,
  readExpectedDataset,
  redoPendingCustomer,
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
  /** `redoOf` = the refused customer this one replaces ("Refazer"); the refused row is closed only when the new one is saved. */
  create(request: CreatePendingCustomerInput["request"], options?: { readonly redoOf?: string }): Promise<PendingCustomerRecord>;
  /**
   * "Refazer": checks the refused customer and returns what to pre-fill. Since I-2 the refused row holds no typed data, so the
   * result is `null` (the seller retypes); the refused row stays, with its reason, until the new one is saved. Changes nothing.
   */
  redo(clientRequestId: string): Promise<CreatePendingCustomerInput["request"] | null>;
  /**
   * Whether the "Novo cliente" entry point should be offered: `false` when the last sync's configuration said
   * `general.clientCreationEnabled === false` (re-read at every sync, no expiry), or after a 409 customer_write_disabled
   * until the next sync. The next sync saying "on" turns it back. Absent in the configuration = not hidden, not inferred.
   */
  creationAvailable(): Promise<boolean>;
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
    async create(request, options) {
      const record = await createPendingCustomer(db, env, {
        ownerAccountId,
        request,
        ...(options?.redoOf === undefined ? {} : { replacesRejected: options.redoOf }),
      });
      onChanged();
      return record;
    },
    redo: (clientRequestId) => redoPendingCustomer(db, ownerAccountId, clientRequestId),
    creationAvailable: () => isCustomerCreationAvailable(db, env),
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
  const confirmed = record.state === "confirmed" && record.customerCode !== null;
  return {
    // Confirmed by the ERP: the REAL code (orders allowed). Otherwise the local negative code, which no screen prints.
    code: confirmed ? (record.customerCode as number) : record.localCode,
    // I-2: once the server answered, the device holds no name; the row is identified by the ERP code or the masked document.
    name: record.name !== "" ? record.name : confirmed ? `Cliente ${record.customerCode}` : "Cadastro não aceito",
    tradeName: record.request?.tradeName ?? null,
    document: record.maskedDocument,
    active: true,
    blocked: false,
    sellerCode: null,
    sellerName: null,
    priceTableCode: null,
    pending: {
      clientRequestId: record.clientRequestId,
      state: record.state,
      rejectionReason: record.rejectionReason,
      waitingForRelease: record.lastError === CUSTOMER_CREATION_NOT_RELEASED && record.state !== "confirmed" && record.state !== "rejected",
    },
  };
}
