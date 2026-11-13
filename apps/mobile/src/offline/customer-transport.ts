import { TransportError, type CustomerRegistrationTransport } from "@salesforce/mobile-db";
import { ApiRequestError, callApi, type ApiClient } from "../data/api";
import { toTransportError } from "./transport";

/**
 * Maps a failed `POST /customers` to the sync engine's classes. The 409s of this endpoint are not order conflicts:
 * a refused registration (duplicate document, rejected by the ERP) is permanent, while a disabled write path is the
 * installation not being ready yet, so the customer stays queued.
 */
export function toCustomerTransportError(error: unknown): TransportError {
  if (error instanceof ApiRequestError && error.status === 409) {
    if (error.code === "idempotency_conflict") return new TransportError("idempotency_conflict", error.message, 409);
    if (error.reason === "document_already_registered" || error.reason === "customer_rejected") {
      return new TransportError("registration_refused", error.message, 409, error.reason);
    }
    if (error.reason === "customer_write_disabled") return new TransportError("server", error.message, 409, "customer_write_disabled");
    return new TransportError("registration_refused", error.message, 409, error.reason);
  }
  return toTransportError(error);
}

/** `CustomerRegistrationTransport` over the generated client. The idempotency key is the clientRequestId of every attempt. */
export function createCustomerTransport(api: ApiClient): CustomerRegistrationTransport {
  return {
    async createCustomer(clientRequestId, request) {
      try {
        const response = await callApi(() =>
          api.POST("/customers", {
            body: { clientRequestId, ...request, addresses: request.addresses.map((address) => ({ ...address })) },
          }),
        );
        return { registrationId: response.registrationId, status: response.status, customerCode: response.customerCode };
      } catch (error) {
        throw toCustomerTransportError(error);
      }
    },
  };
}
