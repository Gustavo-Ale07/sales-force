import { Button, Dialog, DialogContent, titleCase } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ordersQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";

/**
 * Opening "Novo pedido" while a draft saved with "Salvar e sair" exists on the server (same question as the app, which asks
 * "Continuar o pedido em andamento?"). Nothing is kept in the browser: the draft is the one already stored on the server.
 */
export function ResumeDraftDialog({ onContinue }: { onContinue: (id: string) => void }) {
  const api = useApi();
  const [dismissed, setDismissed] = useState(false);
  const drafts = useQuery({ ...ordersQueryOptions(api, { status: "draft", mine: "true", sort: "-updatedAt", page: 1, pageSize: 1 }), retry: false });
  const draft = drafts.data?.items[0];
  if (!draft || dismissed) return null;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : setDismissed(true))}>
      <DialogContent
        title="Continuar o pedido em andamento?"
        description={`Pedido de ${titleCase(draft.customerName)} que não foi enviado. Continue de onde parou ou comece outro.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDismissed(true)}>
              Novo pedido
            </Button>
            <Button variant="primary" onClick={() => onContinue(draft.id)}>
              Continuar
            </Button>
          </>
        }
      >
        <span className="sr-only">Pedido salvo no servidor</span>
      </DialogContent>
    </Dialog>
  );
}
