import { Alert, Button, Dialog, DialogClose, DialogContent } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/api-queries";
import { discardOrder } from "../lib/api-mutations";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";

export interface DiscardOrderDialogProps {
  /** Order to discard; the dialog is open while this is set. */
  order: { id: string; label: string } | null;
  onClose: () => void;
  onDiscarded?: () => void;
}

/** Confirms and discards a draft (`DELETE /orders/{id}`: the status becomes "Descartado"). */
export function DiscardOrderDialog({ order, onClose, onDiscarded }: DiscardOrderDialogProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => discardOrder(api, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      onClose();
      onDiscarded?.();
    },
  });

  const failure = mutation.isError ? describeApiError(mutation.error, "Não foi possível descartar o rascunho") : undefined;

  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => {
        if (!open) {
          mutation.reset();
          onClose();
        }
      }}
    >
      <DialogContent
        title="Descartar rascunho?"
        description={order ? `${order.label} será marcado como descartado e deixará de ser editável.` : undefined}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Manter rascunho</Button>
            </DialogClose>
            <Button variant="danger" loading={mutation.isPending} onClick={() => order && mutation.mutate(order.id)}>
              Descartar
            </Button>
          </>
        }
      >
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
            {failure.correlationId ? <span className="mt-1 block text-xs">Código de correlação: <span className="font-mono">{failure.correlationId}</span></span> : null}
          </Alert>
        ) : (
          <p className="m-0 text-sm text-fg-muted">Esta ação não pode ser desfeita pela interface.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
