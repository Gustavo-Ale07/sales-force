import { Alert, Button, Dialog, DialogClose, DialogContent } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/api-queries";
import { deleteOrder } from "../lib/api-mutations";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";

export interface DeleteOrderDialogProps {
  /** Quote/order to delete; `label` is the reference ("Orçamento nº 12"). The dialog is open while this is set. */
  order: { id: string; label: string } | null;
  onClose: () => void;
  onDeleted?: () => void;
}

/** D-Y: confirms and physically deletes a quote/order that never reached Sankhya (`DELETE /orders/{id}` → 204). */
export function DeleteOrderDialog({ order, onClose, onDeleted }: DeleteOrderDialogProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => deleteOrder(api, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      onClose();
      onDeleted?.();
    },
  });

  const failure = mutation.isError ? describeApiError(mutation.error, "Não foi possível excluir") : undefined;

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
        title={order ? `Excluir ${order.label.charAt(0).toLowerCase()}${order.label.slice(1)}?` : "Excluir?"}
        description="Isso não pode ser desfeito."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Manter</Button>
            </DialogClose>
            <Button variant="danger" loading={mutation.isPending} onClick={() => order && mutation.mutate(order.id)}>
              Excluir
            </Button>
          </>
        }
      >
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
            {failure.correlationId ? <span className="mt-1 block text-xs">Código de correlação: <span className="font-mono">{failure.correlationId}</span></span> : null}
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
