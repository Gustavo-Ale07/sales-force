import type { ApiSchema } from "@salesforce/contracts/client";
import { Alert, Button, toast } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useRef, useState } from "react";
import { ApiRequestError } from "../lib/api";
import { createOrder } from "../lib/api-mutations";
import { queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { requireDataset, useLoadedDataset } from "../lib/dataset";
import { errorStatus } from "../lib/http-error";
import { describeApiError } from "../lib/error-message";
import { describeIssue } from "../lib/order-draft";

type OrderDetail = ApiSchema<"OrderDetail">;

/** Issues that mean "this product cannot be ordered now" (the rest, e.g. totals, are not fixed by dropping a line). */
const LINE_UNAVAILABLE_CODES = new Set(["product_unknown", "product_not_sellable", "line_not_orderable"]);
const ITEM_INDEX = /^items\[(\d+)\]/;

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Indexes (into the items sent) of lines the server refused as unavailable; empty when anything else is wrong. */
function unavailableLineIndexes(error: unknown): number[] {
  if (!(error instanceof ApiRequestError) || error.issues.length === 0) return [];
  const indexes: number[] = [];
  for (const issue of error.issues) {
    const match = ITEM_INDEX.exec(issue.path);
    if (!match || !LINE_UNAVAILABLE_CODES.has(issue.code)) return [];
    indexes.push(Number(match[1]));
  }
  return [...new Set(indexes)];
}

/** Codes already left out of the last attempt plus the ones the server just refused. */
function skipAfterRefusal(all: OrderDetail["items"], sent: OrderDetail["items"], refused: OrderDetail["items"]): ReadonlySet<number> {
  const sentCodes = new Set(sent.map((item) => item.productCode));
  const alreadySkipped = all.filter((item) => !sentCodes.has(item.productCode)).map((item) => item.productCode);
  return new Set([...alreadySkipped, ...refused.map((item) => item.productCode)]);
}

export interface DuplicateOrderButtonProps {
  order: OrderDetail;
  /** Unsaved edits in the editor: the copy is made from the saved order, so the seller saves first. */
  disabled?: boolean;
}

/**
 * "Duplicar pedido": creates a NEW, independent draft for the same customer from the saved order. Only product,
 * quantity and the negotiation type are copied: prices are resolved again by the server, discounts and notes are
 * not carried over (the discount authority is decided per order), and the copy is never linked to the source.
 * Uses `POST /orders` only (no dedicated endpoint). When the server refuses some products as unavailable, the
 * seller sees which ones and may create the draft without them; nothing is dropped silently.
 */
export function DuplicateOrderButton({ order, disabled }: DuplicateOrderButtonProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const loadedDataset = useLoadedDataset();
  // Kept after an unknown outcome (network error, 5xx, 429) so a retry cannot create a second draft.
  const requestId = useRef<{ payload: string; id: string } | null>(null);

  /** Items of the last attempt: the server's issue paths (`items[n]`) index into exactly this list. */
  const [sentItems, setSentItems] = useState<OrderDetail["items"]>([]);

  const mutation = useMutation({
    mutationFn: (skipCodes: ReadonlySet<number>) => {
      const expectedDataset = requireDataset(loadedDataset);
      const itemsToCopy = order.items.filter((item) => !skipCodes.has(item.productCode));
      setSentItems(itemsToCopy);
      const body = {
        customerCode: order.customerCode,
        negotiationTypeCode: order.negotiationTypeCode,
        notes: null,
        items: itemsToCopy.map((item) => ({ productCode: item.productCode, quantity: item.quantity })),
      };
      const payload = JSON.stringify(body);
      if (requestId.current?.payload !== payload) requestId.current = { payload, id: newUuid() };
      return createOrder(api, { clientRequestId: requestId.current.id, expectedDataset, ...body });
    },
    onError: (error) => {
      const status = errorStatus(error);
      const unknownOutcome = status === undefined || status === 0 || status >= 500 || status === 429;
      if (!unknownOutcome) requestId.current = null;
    },
    onSuccess: async (created) => {
      requestId.current = null;
      queryClient.setQueryData(queryKeys.order(created.id), created);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      const skipped = order.items.length - created.items.length;
      toast({
        title: "Rascunho criado a partir do pedido",
        description:
          skipped > 0
            ? `${skipped === 1 ? "1 item ficou" : `${skipped} itens ficaram`} de fora. Preços recalculados; descontos e observações não foram copiados.`
            : "Preços recalculados; descontos e observações não foram copiados.",
        tone: skipped > 0 ? "warning" : "success",
      });
      await navigate({ to: "/pedidos/$id", params: { id: created.id } });
    },
  });

  const blocked = mutation.isError ? unavailableLineIndexes(mutation.error) : [];
  // The failing error refers to the items of the attempt that was sent, which are `sentItems`.
  const blockedItems = blocked.flatMap((index) => (sentItems[index] ? [sentItems[index]] : []));
  const canDropBlocked = blockedItems.length > 0 && blockedItems.length < sentItems.length;
  const failure = mutation.isError ? describeApiError(mutation.error, "Não foi possível duplicar o pedido") : null;

  return (
    <>
      <Button
        variant="secondary"
        leftIcon={<Copy size={14} aria-hidden="true" />}
        loading={mutation.isPending}
        disabled={disabled || mutation.isPending || order.items.length === 0}
        title={disabled ? "Salve as alterações antes de duplicar o pedido" : undefined}
        onClick={() => mutation.mutate(new Set())}
      >
        Duplicar pedido
      </Button>
      {mutation.isError && failure ? (
        <div className="basis-full">
          <Alert
            tone="danger"
            title={blockedItems.length > 0 ? "Alguns itens não podem ser pedidos agora" : failure.title}
            onDismiss={() => mutation.reset()}
            action={
              canDropBlocked ? (
                <Button
                  size="sm"
                  onClick={() => mutation.mutate(skipAfterRefusal(order.items, sentItems, blockedItems))}
                >
                  Duplicar sem esses itens
                </Button>
              ) : undefined
            }
          >
            {blockedItems.length > 0 ? (
              <>
                <span className="block">Nenhum pedido foi criado. Itens recusados pelo servidor:</span>
                <ul className="m-0 mt-1 list-disc pl-4">
                  {mutation.error instanceof ApiRequestError
                    ? mutation.error.issues.map((issue) => {
                        const index = Number(ITEM_INDEX.exec(issue.path)?.[1]);
                        const item = sentItems[index];
                        return (
                          <li key={`${issue.path}:${issue.code}`}>
                            {item ? `${item.productDescription} (código ${item.productCode})` : describeIssue(issue)}:{" "}
                            {describeIssue({ ...issue, path: "" })}
                          </li>
                        );
                      })
                    : null}
                </ul>
              </>
            ) : mutation.error instanceof ApiRequestError && mutation.error.issues.length > 0 ? (
              <ul className="m-0 list-disc pl-4">
                {mutation.error.issues.map((issue) => (
                  <li key={`${issue.path}:${issue.code}`}>{describeIssue(issue)}</li>
                ))}
              </ul>
            ) : (
              failure.description
            )}
            {failure.correlationId ? (
              <span className="mt-1 block text-xs">
                Código de correlação: <span className="font-mono">{failure.correlationId}</span>
              </span>
            ) : null}
          </Alert>
        </div>
      ) : null}
    </>
  );
}
