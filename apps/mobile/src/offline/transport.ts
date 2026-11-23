import { CUSTOMER_BLOCK_MESSAGES, customerBlockMessage, PENDING_CUSTOMER_MESSAGE, TransportError, type OrderTransport, type RemoteOrder, type TransportErrorKind } from "@salesforce/mobile-db";
import { ApiRequestError, callApi, type ApiClient } from "../data/api";
import { describeIssue } from "../data/order-draft";
import type { OrderDetail } from "../data/ports";

/** Maps a failed API call to the sync engine's error classes (`docs/architecture.md` §5.3 classes). */
export function toTransportError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  if (!(error instanceof ApiRequestError)) return new TransportError("server", "Falha inesperada.");
  const { status, code } = error;
  if (status === 0) return new TransportError("network", error.message);
  if (code === "version_conflict") return new TransportError("version_conflict", error.message, status);
  if (code === "order_not_editable") return new TransportError("not_editable", error.message, status);
  if (code === "idempotency_conflict") return new TransportError("idempotency_conflict", error.message, status);
  if (code === "dataset_mismatch") return new TransportError("dataset_mismatch", error.message, status);
  // A customer without a seller is held the same way as an unavailable one: permanent, draft kept for review.
  if (code === "customer_without_seller") return new TransportError("customer_ineligible", error.message, status, "customer_without_seller");
  if (code === "customer_ineligible") return new TransportError("customer_ineligible", error.message, status, error.reason);
  if (status === 401) return new TransportError("auth", error.message, status);
  if (status === 404) return new TransportError("not_found", error.message, status);
  if (status === 429) return new TransportError("rate_limit", error.message, status);
  if (status >= 500) return new TransportError("server", error.message, status);
  const kind: TransportErrorKind = "validation";
  const message =
    error.issues.length > 0
      ? error.issues.map(describeIssue).join(" ")
      : status === 403
        ? "Seu perfil não tem permissão para esta operação."
        : "O servidor recusou este pedido. Revise os dados.";
  return new TransportError(kind, message, status);
}

/** Issue codes of the order header (type of operation, negotiation, freight, carrier): the "header not eligible" popup. */
const HEADER_ISSUE_CODES: ReadonlySet<string> = new Set(["order_top_not_eligible", "negotiation_type_not_configured", "missing_top", "missing_negotiation_type", "missing_freight_type", "missing_carrier"]);

/** 409 `details.reason`s of `POST /orders/{id}/submit` that have their own popup (same reasons as the web's K4 texts). */
const SUBMIT_CONFLICT_REASONS: ReadonlySet<string> = new Set([
  "edit_before_resubmitting",
  "needs_manager_approval",
  "approval_required_before_resend",
  "invalid_status",
  "legacy_dataset",
  "dataset_not_erp",
  "environment_unbound",
  "environment_mismatch",
  "delivery_diverged",
  "ambiguous_origin",
]);

/**
 * Maps a failed `POST /orders/{id}/submit` to the sync engine's classes. Network, session, rate limit and server failures are
 * transient (the send request stays queued). Every other answer is a definitive refusal (`send_refused`): `reason` is the catalog
 * problem code the popup shows, `message` the seller text kept as a fallback. The server's decision is never reinterpreted.
 */
export function toSubmitError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  if (!(error instanceof ApiRequestError)) return new TransportError("server", "Falha inesperada.");
  const { status, code, reason } = error;
  if (status === 0) return new TransportError("network", error.message);
  if (status === 401) return new TransportError("auth", error.message, status);
  if (status === 429) return new TransportError("rate_limit", error.message, status);
  if (status >= 500) return new TransportError("server", error.message, status);
  const refuse = (key: string, message: string = error.message): TransportError => new TransportError("send_refused", message, status, key);
  if (code === "erp_submission_disabled") return refuse("erp_submission_disabled");
  if (code === "discount_blocked") return refuse("discount_blocked");
  if (code === "customer_without_seller") return refuse("customer_without_seller", customerBlockMessage("customer_without_seller"));
  if (code === "customer_ineligible") {
    const cause = reason !== undefined && Object.hasOwn(CUSTOMER_BLOCK_MESSAGES, reason) ? reason : "customer_ineligible";
    return refuse(cause, customerBlockMessage(reason));
  }
  if (code === "version_conflict") return refuse("version_conflict");
  if (code === "order_not_editable") return refuse("order_not_editable");
  if (code === "dataset_mismatch") return refuse("dataset_mismatch");
  if (code === "conflict" && reason !== undefined && SUBMIT_CONFLICT_REASONS.has(reason)) return refuse(reason);
  if (error.issues.length > 0) {
    if (error.issues.some((issue) => HEADER_ISSUE_CODES.has(issue.code))) return refuse("header_not_eligible", error.issues.map(describeIssue).join(" "));
    return refuse("validation_failed", error.issues.map(describeIssue).join(" "));
  }
  if (status === 404) return refuse("not_found");
  if (status === 403) return refuse("forbidden");
  return refuse(code === "validation_failed" ? "validation_failed" : "send_refused");
}

export function toRemoteOrder(order: OrderDetail): RemoteOrder {
  return {
    id: order.id,
    version: order.version,
    draftNumber: order.draftNumber,
    customerCode: order.customerCode,
    customerName: order.customerName,
    negotiationTypeCode: order.negotiationTypeCode,
    topCode: order.topCode,
    carrierCode: order.carrierCode,
    freightType: order.freightType,
    notes: order.notes,
    estimatedTotal: order.estimatedTotal,
    items: order.items.map((item) => ({
      productCode: item.productCode,
      productDescription: item.productDescription,
      unit: item.unit,
      quantity: item.quantity,
      unitListPrice: item.unitListPrice,
      priceState: item.priceState,
      priceTableCode: item.priceTableCode,
      priceVersionId: item.priceVersionId,
      discountPercent: item.discountPercent,
      ...(item.ipi === undefined ? {} : { ipi: item.ipi }),
    })),
  };
}

/**
 * `OrderTransport` over the generated API client. Only product, quantity and discount travel: prices, totals and
 * validation are resolved server-side (P-09), and the body never carries a price.
 */
export function createOrderTransport(api: ApiClient): OrderTransport {
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw toTransportError(error);
    }
  };
  return {
    // `expectedDataset` is the identity stored on the outbox row (what the draft originated under), never "the current one".
    createOrder: (clientRequestId, request, expectedDataset) =>
      guard(async () => {
        // Last line of defense: a local (negative) customer code is not a Sankhya code and never travels in an order body.
        if (request.customerCode < 0) throw new TransportError("validation", PENDING_CUSTOMER_MESSAGE);
        return toRemoteOrder(
          await callApi(() =>
            api.POST("/orders", {
              body: { clientRequestId, expectedDataset: { environment: expectedDataset.environment, datasetId: expectedDataset.datasetId }, ...request, items: [...request.items] },
            }),
          ),
        );
      }),
    replaceOrder: (id, expectedVersion, request, expectedDataset) =>
      guard(async () => {
        if (request.customerCode < 0) throw new TransportError("validation", PENDING_CUSTOMER_MESSAGE);
        return toRemoteOrder(
          await callApi(() =>
            api.PUT("/orders/{id}", {
              params: { path: { id } },
              body: { expectedVersion, expectedDataset: { environment: expectedDataset.environment, datasetId: expectedDataset.datasetId }, ...request, items: [...request.items] },
            }),
          ),
        );
      }),
    getOrder: (id) => guard(async () => toRemoteOrder(await callApi(() => api.GET("/orders/{id}", { params: { path: { id } } })))),
    // "Enviar pedido": the generated client, no body. The server revalidates everything and answers a replay with the current state.
    submitOrder: async (id) => {
      try {
        const order = await callApi(() => api.POST("/orders/{id}/submit", { params: { path: { id } } }));
        return { status: order.status, version: order.version, erpNumber: order.erpNumber ?? null };
      } catch (error) {
        throw toSubmitError(error);
      }
    },
  };
}
