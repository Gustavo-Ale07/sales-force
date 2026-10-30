import type { ApiSchema } from "@salesforce/contracts/client";
import { Alert, Button, toast } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CopyPlus } from "lucide-react";
import { useRef } from "react";
import { duplicateAsOrder } from "../lib/api-mutations";
import { queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { requireDataset, useLoadedDataset } from "../lib/dataset";
import { errorStatus } from "../lib/http-error";
import { describeDuplicateAsOrderError, skippedLinesOf } from "../lib/order-templates";
import { TemplateSkippedNotice } from "./template-skipped-notice";

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

export interface DuplicateAsOrderButtonProps {
  order: ApiSchema<"OrderDetail">;
  /** Unsaved edits: the copy is made from the saved quotation. */
  disabled?: boolean;
}

/**
 * "Duplicar como pedido" (D-B): turns a quotation (TOP 1000) into a NEW draft carrying the default order TOP. The quotation is
 * never changed. Lines the server could not carry over are listed (`skippedLines`), never dropped silently.
 */
export function DuplicateAsOrderButton({ order, disabled }: DuplicateAsOrderButtonProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const loadedDataset = useLoadedDataset();
  // Kept across an unknown outcome so a retry cannot create a second draft.
  const requestId = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const expectedDataset = requireDataset(loadedDataset);
      if (!requestId.current) requestId.current = newUuid();
      return duplicateAsOrder(api, order.id, { clientRequestId: requestId.current, expectedDataset });
    },
    onError: (error) => {
      const status = errorStatus(error);
      const unknownOutcome = status === undefined || status === 0 || status >= 500 || status === 429;
      if (!unknownOutcome) requestId.current = null;
    },
    onSuccess: async (result) => {
      requestId.current = null;
      queryClient.setQueryData(queryKeys.order(result.order.id), result.order);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      if (result.skippedLines.length === 0) toast({ title: "Pedido criado a partir do orçamento", tone: "success" });
      await navigate({
        to: "/pedidos/$id",
        params: { id: result.order.id },
        state: { orderNotice: { source: "duplicate-as-order", skippedLines: result.skippedLines } },
      });
    },
  });

  const failure = mutation.isError ? describeDuplicateAsOrderError(mutation.error) : null;
  return (
    <>
      <Button
        variant="primary"
        leftIcon={<CopyPlus size={14} aria-hidden="true" />}
        loading={mutation.isPending}
        disabled={disabled || mutation.isPending || order.items.length === 0 || order.status === "cancelled"}
        title={disabled ? "Salve as alterações antes de duplicar como pedido" : undefined}
        onClick={() => mutation.mutate()}
      >
        Duplicar como pedido
      </Button>
      {failure ? (
        <div className="basis-full">
          <Alert tone="danger" title={failure.title} onDismiss={() => mutation.reset()}>
            {failure.description}
            {failure.reason === "no_usable_lines" ? <TemplateSkippedNotice lines={skippedLinesOf(mutation.error)} /> : null}
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
