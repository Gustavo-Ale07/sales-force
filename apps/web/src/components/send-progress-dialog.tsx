import type { DocumentKind } from "@salesforce/domain";
import { Button, FullScreenLoading } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { submitOrder } from "../lib/api-mutations";
import { orderQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";
import { SEND_POLL_MS, SEND_WAIT_MS, sendOutcomeOf } from "../lib/send-outcome";
import { DeleteOrderDialog } from "./delete-order-dialog";

export interface SendProgressDialogProps {
  /** The order being sent; the dialog is open while this is set. */
  orderId: string | null;
  kind: DocumentKind;
  /** Reference shown under the title ("Pedido nº 12"). */
  reference: string;
  /** The seller closed the dialog (only possible once the outcome is known). */
  onClose: () => void;
  /** The order was deleted from the failure state. */
  onDeleted: () => void;
}

/**
 * D-AB B2: blocking dialog opened by "Confirmar pedido". It reads the order every SEND_POLL_MS for up to SEND_WAIT_MS and
 * shows what happened. It never shows the word "fila". Closing is blocked while the outcome is unknown.
 */
export function SendProgressDialog({ orderId, kind, reference, onClose, onDeleted }: SendProgressDialogProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [startedAt, setStartedAt] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    if (orderId === null) return undefined;
    const timer = setTimeout(() => setTimedOut(true), SEND_WAIT_MS);
    return () => clearTimeout(timer);
  }, [orderId, startedAt]);

  const query = useQuery({
    ...orderQueryOptions(api, orderId ?? ""),
    enabled: orderId !== null,
    refetchInterval: (state) => {
      const data = state.state.data;
      if (timedOut) return false;
      return data && sendOutcomeOf(data, kind, false).final ? false : SEND_POLL_MS;
    },
    staleTime: 0,
  });

  const resend = useMutation({
    mutationFn: async () => {
      if (orderId === null) throw new Error("Sem documento para reenviar.");
      return submitOrder(api, orderId);
    },
    onSuccess: async (result) => {
      if (orderId !== null && result) queryClient.setQueryData(queryKeys.order(orderId), result);
      setStartedAt(Date.now());
    },
  });

  const order = query.data;
  const outcome = order ? sendOutcomeOf(order, kind, timedOut) : { phase: "sending", title: "Enviando ao Sankhya…", detail: null, final: false };
  const busy = !outcome.final || resend.isPending;
  const resendError = resend.isError ? describeApiError(resend.error, "Não foi possível reenviar") : null;
  const loadError = query.isError && !order ? describeApiError(query.error, "Não foi possível consultar o envio") : null;

  const finish = () => {
    resend.reset();
    onClose();
  };

  return (
    <>
      <FullScreenLoading
        open={orderId !== null && !deleting}
        onClose={finish}
        busy={busy}
        title={outcome.phase === "sending" ? "Enviando ao Sankhya…" : "Envio ao Sankhya"}
        label="Envio ao Sankhya"
        action={busy ? "Enviando o pedido ao Sankhya…" : outcome.title}
        meta={busy ? null : outcome.detail}
        outcome={busy ? null : outcome.phase === "confirmed" || outcome.phase === "released_pending" || outcome.phase === "simulated" ? "ok" : "warn"}
        actions={
          busy ? undefined : (
            <>
              {outcome.phase === "failed" ? (
                <>
                  <Button variant="danger-outline" className="border-[#fca5a5] bg-transparent text-[#fca5a5] hover:bg-white/10" onClick={() => setDeleting(true)}>
                    Excluir
                  </Button>
                  <Button variant="secondary" className="border-white/50 bg-transparent text-white hover:bg-white/10" loading={resend.isPending} onClick={() => resend.mutate()}>
                    Reenviar
                  </Button>
                </>
              ) : null}
              <Button variant="primary" className="border-transparent bg-white text-[var(--sf-navy)] hover:bg-white/90" onClick={finish}>
                Fechar
              </Button>
            </>
          )
        }
      >
        <p className="m-0 -mt-2 text-sm text-white/80">{reference}</p>
        {resendError ? (
          <p role="alert" className="m-0 max-w-md text-sm text-[#fde68a]">
            <strong>{resendError.title}.</strong> {resendError.description}
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="m-0 max-w-md text-sm text-[#fde68a]">
            <strong>{loadError.title}.</strong> {loadError.description}
          </p>
        ) : null}
      </FullScreenLoading>
      <DeleteOrderDialog
        order={deleting && orderId !== null ? { id: orderId, label: reference } : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false);
          resend.reset();
          onDeleted();
        }}
      />
    </>
  );
}
