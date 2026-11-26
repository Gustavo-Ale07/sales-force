import { TransportError, type CustomerEditTransport, type CustomerLike, type CustomerRegistrationTransport } from "@salesforce/mobile-db";
import { ApiRequestError, callApi, type ApiClient } from "../data/api";
import type { CustomerDetail } from "../data/ports";
import { toTransportError } from "./transport";

/**
 * Maps a failed `POST /customers` to the sync engine's classes. The 409s of this endpoint are not order conflicts:
 * a refused registration (duplicate document, rejected by the ERP) is permanent, while a disabled write path is the
 * installation not being ready yet, so the customer stays queued.
 */
export function toCustomerTransportError(error: unknown): TransportError {
  // 422 customer_refused: the server's text per field (missing seller, repeated document, required field); shown on the form.
  if (error instanceof ApiRequestError && error.status === 422) {
    return new TransportError("validation", error.message, 422, error.code, Object.keys(error.fields).length > 0 ? error.fields : { _: error.message });
  }
  // 400 validation_failed: the issue paths name the field (`addresses.0.cityCode` -> `cityCode`), so the form shows the text on that field.
  if (error instanceof ApiRequestError && error.status === 400 && error.issues.length > 0) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const parts = issue.path.split(".");
      const key = parts[0] === "addresses" ? parts.slice(2).join(".") || "addresses" : (parts[0] ?? "_");
      fields[key] = key === "cityCode" ? "Informe a cidade." : (issue.message ?? "Valor inválido.");
    }
    return new TransportError("validation", Object.values(fields)[0] ?? error.message, 400, error.code, fields);
  }
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

/** The mirror's list shape from a customer sheet: nothing the list does not carry (no credit limit, table name or sync stamp). */
export function toCustomerLike(detail: CustomerDetail): CustomerLike {
  return {
    code: detail.code,
    name: detail.name,
    tradeName: detail.tradeName,
    document: detail.document,
    active: detail.active,
    blocked: detail.blocked,
    sellerCode: detail.sellerCode,
    sellerName: detail.sellerName,
    priceTableCode: detail.priceTableCode,
  };
}

/** `CustomerRegistrationTransport` over the generated client. The idempotency key is the clientRequestId of every attempt. */
export function createCustomerTransport(api: ApiClient): CustomerRegistrationTransport {
  return {
    async createCustomer(clientRequestId, request) {
      try {
        const response = await callApi(() =>
          api.POST("/customers", {
            body: { clientRequestId, ...request, addresses: request.addresses.map((address) => ({
                streetCode: 0,
                neighborhoodCode: 0,
                streetName: null,
                neighborhoodName: null,
                number: null,
                complement: null,
                postalCode: null,
                ...address,
              })),
            },
          }),
        );
        // 201 sent (real code) / 202 pending (still being delivered): the server's sendState decides.
        const confirmed = response.sendState === "sent" && response.customerCode !== null;
        return { registrationId: response.registrationId, status: confirmed ? "confirmed" : "pending", customerCode: response.customerCode };
      } catch (error) {
        throw toCustomerTransportError(error);
      }
    },
    async getCustomer(code) {
      try {
        return toCustomerLike(await callApi(() => api.GET("/customers/{code}", { params: { path: { code } } })));
      } catch (error) {
        throw toTransportError(error);
      }
    },
  };
}

/** Maps a failed `PATCH /customers/{code}`: the edit conflict keeps the ERP's current values; a 422 is a refusal; the rest is the common mapping. */
export function toCustomerEditTransportError(error: unknown): TransportError {
  if (error instanceof ApiRequestError && error.status === 409 && error.reason === "customer_edit_conflict") {
    const current = error.details.current;
    const values = typeof current === "object" && current !== null ? (current as Record<string, unknown>) : {};
    return new TransportError("edit_conflict", error.message, 409, error.reason, {
      phone: typeof values.phone === "string" ? values.phone : "",
      email: typeof values.email === "string" ? values.email : "",
      contactVersion: typeof error.details.contactVersion === "string" ? error.details.contactVersion : "",
    });
  }
  if (error instanceof ApiRequestError && error.status === 422) return new TransportError("validation", error.message, 422, error.code);
  if (error instanceof ApiRequestError && error.status === 409) {
    if (error.code === "idempotency_conflict") return new TransportError("idempotency_conflict", error.message, 409);
    // Edit switched off or a field the ERP mapping does not carry yet: the installation is not ready, the edit stays queued.
    if (error.reason === "customer_edit_disabled") return new TransportError("server", error.message, 409, error.reason);
    return new TransportError("validation", error.message, 409, error.reason);
  }
  return toTransportError(error);
}

/** `CustomerEditTransport` over the generated client; the request id is the idempotency key of every attempt. */
export function createCustomerEditTransport(api: ApiClient): CustomerEditTransport {
  return {
    async updateCustomer(clientRequestId, customerCode, changes, baseContactVersion) {
      try {
        await callApi(() =>
          api.PATCH("/customers/{code}", {
            params: { path: { code: customerCode } },
            body: { clientRequestId, ...(baseContactVersion === null ? {} : { baseContactVersion }), ...changes },
          }),
        );
      } catch (error) {
        throw toCustomerEditTransportError(error);
      }
    },
  };
}
