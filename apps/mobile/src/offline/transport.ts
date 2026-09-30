import { TransportError, type OrderTransport, type RemoteOrder, type TransportErrorKind } from "@salesforce/mobile-db";
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

export function toRemoteOrder(order: OrderDetail): RemoteOrder {
  return {
    id: order.id,
    version: order.version,
    draftNumber: order.draftNumber,
    customerCode: order.customerCode,
    customerName: order.customerName,
    negotiationTypeCode: order.negotiationTypeCode,
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
    createOrder: (clientRequestId, request) =>
      guard(async () => toRemoteOrder(await callApi(() => api.POST("/orders", { body: { clientRequestId, ...request, items: [...request.items] } })))),
    replaceOrder: (id, expectedVersion, request) =>
      guard(async () =>
        toRemoteOrder(await callApi(() => api.PUT("/orders/{id}", { params: { path: { id } }, body: { expectedVersion, ...request, items: [...request.items] } }))),
      ),
    getOrder: (id) => guard(async () => toRemoteOrder(await callApi(() => api.GET("/orders/{id}", { params: { path: { id } } })))),
  };
}
