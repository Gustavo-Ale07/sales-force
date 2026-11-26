import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  Money,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { resolveOrderPriceReview } from "../lib/api-mutations";
import { orderPriceReviewQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { requireDataset, useLoadedDataset } from "../lib/dataset";
import { describeApiError } from "../lib/error-message";

type Choice = "accept" | "refuse";
type Line = ApiSchema<"PriceReviewLine">;

const NO_PRICE = "Sem preço";

/**
 * P-09: the table price of some lines changed. The seller decides line by line: accept (the line takes the current price)
 * or refuse (the line leaves the order). The server prices again and validates; nothing is replaced silently.
 */
export function OrderPriceReviewDialog({ orderId }: { orderId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const loadedDataset = useLoadedDataset();
  const review = useQuery(orderPriceReviewQueryOptions(api, orderId));
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [postponed, setPostponed] = useState(false);

  const lines: readonly Line[] = review.data?.lines ?? [];
  const decided = lines.length > 0 && lines.every((line) => choices[line.lineNo] !== undefined);

  const resolve = useMutation({
    mutationFn: () =>
      resolveOrderPriceReview(api, orderId, {
        expectedVersion: review.data?.version ?? 1,
        expectedDataset: requireDataset(loadedDataset),
        decisions: lines.map((line) => ({
          lineNo: line.lineNo,
          decision: choices[line.lineNo] ?? "refuse",
        })),
      }),
    onSuccess: async (order) => {
      queryClient.setQueryData(queryKeys.order(orderId), order);
      await queryClient.invalidateQueries({ queryKey: queryKeys.orderPriceReview(orderId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      setChoices({});
      toast({ title: "Preços conferidos", tone: "success" });
    },
  });

  const failure = resolve.isError ? describeApiError(resolve.error, "Não foi possível conferir os preços") : undefined;

  return (
    <Dialog open={lines.length > 0 && !postponed} onOpenChange={(open) => (open ? undefined : setPostponed(true))}>
      <DialogContent
        title="Preços alterados"
        footer={
          <>
            <Button variant="secondary" disabled={resolve.isPending} onClick={() => setPostponed(true)}>
              Decidir depois
            </Button>
            <Button variant="primary" loading={resolve.isPending} disabled={!decided || resolve.isPending} onClick={() => resolve.mutate()}>
              Confirmar
            </Button>
          </>
        }
      >
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
          </Alert>
        ) : null}
        <Table label="Itens com preço alterado">
          <TableCaption>Itens com preço alterado</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead numeric>Qtd.</TableHead>
              <TableHead numeric>Preço anterior</TableHead>
              <TableHead numeric>Preço atual</TableHead>
              <TableHead>
                <span className="sr-only">Decisão</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.lineNo}>
                <TableCell wrap className="font-medium">
                  {line.productDescription}
                </TableCell>
                <TableCell numeric>{line.quantity}</TableCell>
                <TableCell numeric>
                  <Money value={line.previousUnitPrice} minFractionDigits={2} maxFractionDigits={6} fallback={NO_PRICE} />
                </TableCell>
                <TableCell numeric>
                  <Money value={line.currentUnitPrice} minFractionDigits={2} maxFractionDigits={6} fallback={NO_PRICE} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1" role="group" aria-label={`Decisão para ${line.productDescription}`}>
                    <Button
                      size="sm"
                      variant={choices[line.lineNo] === "accept" ? "primary" : "secondary"}
                      aria-pressed={choices[line.lineNo] === "accept"}
                      aria-label={`Aceitar preço de ${line.productDescription}`}
                      disabled={line.currentUnitPrice === null}
                      onClick={() => setChoices((current) => ({ ...current, [line.lineNo]: "accept" }))}
                    >
                      Aceitar
                    </Button>
                    <Button
                      size="sm"
                      variant={choices[line.lineNo] === "refuse" ? "danger" : "secondary"}
                      aria-pressed={choices[line.lineNo] === "refuse"}
                      aria-label={`Recusar preço de ${line.productDescription}`}
                      onClick={() => setChoices((current) => ({ ...current, [line.lineNo]: "refuse" }))}
                    >
                      Recusar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
