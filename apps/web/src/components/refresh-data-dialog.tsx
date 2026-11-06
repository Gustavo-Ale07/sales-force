import { Alert, Button, Dialog, DialogContent, Spinner } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Minus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { startSyncRefresh } from "../lib/api-mutations";
import { queryKeys, syncRefreshQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";
import { ENTITY_LABELS, REFRESH_POLL_MS, clockTime, failedSteps, stepDetail, type SyncRefreshStep } from "../lib/sync-refresh";

export interface RefreshDataDialogProps {
  open: boolean;
  onClose: () => void;
}

function StepIcon({ status }: { status: SyncRefreshStep["status"] }) {
  if (status === "running") return <Spinner size={16} label="Lendo" />;
  if (status === "ok") return <Check size={16} className="text-[var(--sf-success,currentColor)]" aria-label="Atualizado" />;
  if (status === "failed") return <X size={16} className="text-[var(--sf-danger,currentColor)]" aria-label="Falhou" />;
  if (status === "skipped") return <Minus size={16} className="text-fg-muted" aria-label="Não aplicável" />;
  return <Circle size={16} className="text-fg-muted" aria-label="Aguardando" />;
}

/**
 * D-AB B3: "Atualizar dados" really reads Sankhya on demand. The API records the request and the worker runs it; this
 * dialog shows one row per entity and, at the end, reloads every screen. A failed entity keeps its old data and says so,
 * with the time of the last success: it is never silent. Closing is blocked while the worker is reading.
 */
export function RefreshDataDialog({ open, onClose }: RefreshDataDialogProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const started = useRef(false);

  const start = useMutation({ mutationFn: () => startSyncRefresh(api) });
  const refreshId = start.data?.id ?? null;

  const progress = useQuery({
    ...syncRefreshQueryOptions(api, refreshId ?? ""),
    enabled: refreshId !== null,
    refetchInterval: (state) => (state.state.data?.status === "done" ? false : REFRESH_POLL_MS),
    staleTime: 0,
  });

  useEffect(() => {
    if (!open) {
      started.current = false;
      start.reset();
      return;
    }
    if (started.current) return;
    started.current = true;
    start.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refresh = progress.data ?? (start.data ? { ...start.data } : undefined);
  const done = refresh?.status === "done";

  // Once finished: every screen reads the server again, and the age shown in the menu is refreshed.
  const reloaded = useRef<string | null>(null);
  useEffect(() => {
    if (!done || refresh === undefined || reloaded.current === refresh.id) return;
    reloaded.current = refresh.id;
    void queryClient.invalidateQueries();
    void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus });
  }, [done, refresh, queryClient]);

  const startError = start.isError ? describeApiError(start.error, "Não foi possível iniciar a atualização") : null;
  const loadError = progress.isError && !progress.data ? describeApiError(progress.error, "Não foi possível acompanhar a atualização") : null;
  const busy = !startError && !done && !loadError;
  const failed = refresh ? failedSteps(refresh) : [];
  const finishedAt = refresh?.finishedAt ? clockTime(refresh.finishedAt) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        title="Atualizando dados do Sankhya"
        description={done ? (finishedAt ? `Atualizado às ${finishedAt}` : "Atualização concluída") : "Lendo as informações do Sankhya. Não feche esta janela."}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        footer={
          busy ? undefined : (
            <>
              {startError || loadError ? (
                <Button variant="secondary" onClick={() => (startError ? start.mutate() : void progress.refetch())}>
                  Tentar de novo
                </Button>
              ) : null}
              <Button variant="primary" onClick={onClose}>
                Fechar
              </Button>
            </>
          )
        }
      >
        {startError ? (
          <Alert tone="danger" title={startError.title}>
            {startError.description}
          </Alert>
        ) : null}
        {loadError ? (
          <Alert tone="warning" title={loadError.title}>
            {loadError.description}
          </Alert>
        ) : null}
        {done && failed.length > 0 ? (
          <Alert tone="warning" title={`Não foi possível atualizar: ${failed.map((step) => ENTITY_LABELS[step.entity]).join(", ")}`} className="mb-3">
            Os dados anteriores foram mantidos. Tente de novo em instantes.
          </Alert>
        ) : null}
        {refresh ? (
          <ul className="m-0 grid list-none gap-1 p-0" aria-label="Andamento por informação" aria-live="polite">
            {refresh.steps.map((step) => (
              <li key={step.entity} className="flex items-start gap-2 text-sm" data-status={step.status}>
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  <StepIcon status={step.status} />
                </span>
                <span className="min-w-0 flex-1 font-medium text-fg">{ENTITY_LABELS[step.entity]}</span>
                <span className="max-w-[55%] text-right text-fg-muted">{stepDetail(step)}</span>
              </li>
            ))}
          </ul>
        ) : startError ? null : (
          <div className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Spinner size={16} label="Iniciando" /> Iniciando…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
