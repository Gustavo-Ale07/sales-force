import {
  assignPendingCustomerSeller,
  createPendingCustomer,
  discardPendingCustomer,
  isCustomerCreationAvailable,
  isCustomerEditAvailable,
  listPendingCustomers,
  readExpectedDataset,
  retryPendingCustomer,
  submitCustomer,
  type CreatePendingCustomerInput,
  type CustomerRegistrationTransport,
  type OfflineEnv,
  type PendingCustomerRecord,
  type SqlDatabase,
  type SubmitCustomerResult,
} from "@salesforce/mobile-db";
import type { CustomerListItem } from "../data/ports";

export { PENDING_CUSTOMER_MESSAGE, CustomerRejectedError } from "@salesforce/mobile-db";
export type { SubmitCustomerResult } from "@salesforce/mobile-db";

/**
 * Customers registered from this device. With a connection the server creates the customer in the ERP at once; without one (or on a
 * timeout / 202) it is saved on the device and the sync manager delivers it with the same idempotency key.
 */
export interface PendingCustomersPort {
  /**
   * "Cadastrar". `online: true` calls the server directly (201: the customer is in the list with its code; a refusal throws
   * `CustomerRejectedError` with the field -> text map and saves nothing). Otherwise it is saved and sent by itself later.
   */
  submit(request: CreatePendingCustomerInput["request"], options: { readonly online: boolean }): Promise<SubmitCustomerResult>;
  /** Offline-only save (no call). */
  create(request: CreatePendingCustomerInput["request"]): Promise<PendingCustomerRecord>;
  /**
   * Whether the "Novo cliente" entry point should be offered: `false` when the last sync's configuration said
   * `general.clientCreationEnabled === false` (re-read at every sync, no expiry), or after a 409 customer_write_disabled
   * until the next sync. The next sync saying "on" turns it back. Absent in the configuration = not hidden, not inferred.
   */
  creationAvailable(): Promise<boolean>;
  /** Whether "Editar cliente" is offered: only while the last sync's `general.clientEditEnabled` was true (unknown = hidden). */
  editAvailable?(): Promise<boolean>;
  list(search?: string): Promise<PendingCustomerRecord[]>;
  /** Makes a waiting customer due now. */
  resend(clientRequestId: string): Promise<void>;
  /** Local delete of a customer never sent. */
  discard(clientRequestId: string): Promise<void>;
  /** A manager/admin picks the seller of a customer held without one; it is sent again right away. */
  assignSeller(clientRequestId: string, sellerCode: number): Promise<void>;
}

export function createPendingCustomersPort(deps: {
  readonly db: SqlDatabase;
  readonly env: OfflineEnv;
  readonly ownerAccountId: string;
  readonly transport: CustomerRegistrationTransport;
  /** Counters and listing refresh after a change; a sync can start when online. */
  readonly onChanged: () => void;
}): PendingCustomersPort {
  const { db, env, ownerAccountId, transport, onChanged } = deps;
  return {
    async submit(request, options) {
      try {
        return await submitCustomer(db, env, transport, ownerAccountId, request, options);
      } finally {
        onChanged();
      }
    },
    async create(request) {
      const record = await createPendingCustomer(db, env, { ownerAccountId, request });
      onChanged();
      return record;
    },
    creationAvailable: () => isCustomerCreationAvailable(db, env),
    editAvailable: () => isCustomerEditAvailable(db),
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
    async assignSeller(clientRequestId, sellerCode) {
      await assignPendingCustomerSeller(db, env, ownerAccountId, clientRequestId, sellerCode);
      onChanged();
    },
  };
}

/**
 * A pending customer as a list row. The code is the negative local one; document is masked; nothing about credit or
 * price table exists for it. Once the ERP answered, the REAL code replaces the local one (orders allowed).
 */
export function toPendingListItem(record: PendingCustomerRecord): CustomerListItem {
  const confirmed = record.state === "confirmed" && record.customerCode !== null;
  const seller = record.request?.sellerCode ?? null;
  return {
    code: confirmed ? (record.customerCode as number) : record.localCode,
    name: record.name !== "" ? record.name : `Cliente ${record.customerCode ?? ""}`.trim(),
    tradeName: record.request?.tradeName ?? null,
    document: record.maskedDocument === "" ? null : record.maskedDocument,
    active: true,
    blocked: false,
    sellerCode: seller,
    sellerName: null,
    priceTableCode: null,
    pending: {
      clientRequestId: record.clientRequestId,
      state: record.state,
      needsSeller: record.needsSeller,
    },
  };
}
