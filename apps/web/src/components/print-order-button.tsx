import type { ApiSchema } from "@salesforce/contracts/client";
import { Button, toast } from "@salesforce/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";
import { orderQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";
import { buildOrderHtml } from "../lib/order-print";
import { printHtml } from "../lib/print-html";

export interface PrintOrderButtonProps {
  orderId: string;
  /** Used in the accessible name, e.g. "Pedido 42". */
  label: string;
  /** The saved order when already loaded (detail); the list passes only the id and the order is read first. */
  order?: ApiSchema<"OrderDetail">;
  disabled?: boolean;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost";
  /** Stops the click from activating the table row. */
  stopPropagation?: boolean;
}

/** "Imprimir / PDF": opens the print dialog with the PLAC order template (A4); "Salvar como PDF" is chosen there. */
export function PrintOrderButton({ orderId, label, order, disabled, size = "md", variant = "secondary", stopPropagation }: PrintOrderButtonProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const detail = order ?? (await queryClient.fetchQuery({ ...orderQueryOptions(api, orderId), staleTime: 0 }));
      printHtml(buildOrderHtml(detail, window.location.origin));
    } catch (error) {
      const failure = describeApiError(error, "Não foi possível preparar o pedido para impressão");
      toast({ title: failure.title, description: failure.description, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size={size}
      variant={variant}
      aria-label={`Imprimir / PDF ${label}`}
      leftIcon={<Printer size={size === "sm" ? 13 : 14} aria-hidden="true" />}
      loading={busy}
      disabled={disabled || busy}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation();
        void run();
      }}
      onKeyDown={stopPropagation ? (event) => event.stopPropagation() : undefined}
    >
      Imprimir / PDF
    </Button>
  );
}
