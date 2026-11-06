import { Alert, Button, Dialog, DialogContent, LoadingHero, StepGroup, StepRow } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { startSyncRefresh } from "../lib/api-mutations";
import { queryKeys, syncRefreshQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";
import {
  ENTITY_LABELS,
  ENTITY_ACTION,
  PHASE_CAPTION,
  REFRESH_GROUPS,
  REFRESH_POLL_MS,
  REFRESH_STALLED_AFTER_S,
  REFRESH_WAITING_AFTER_S,
  STEP_STATE,
  clockTime,
  currentStep,
  seesRefreshDetail,
  stepCount,
  stepNote,
  stepProgress,
  type SyncRefresh,
} from "../lib/sync-refresh";

export interface RefreshDataDialogProps {
  open: boolean;
  onClose: () => void;
  /** Profile of the signed-in user: picks the title before the server answers. The shape of the answer is decided by the server (D-AC). */
  role: string;
}

/**
 * D-AB B3 + D-AC C2: "Atualizar dados" really reads Sankhya on demand (API records, worker reads). Two views, chosen by the
 * server's answer: the seller gets a bar and a sentence per phase; manager, admin and technical get three blocks with one
 * row per entity. No X and no "não feche" text: the dialog only blocks while the worker is reading. A failed entity keeps
 * its old data and says so; it is never silent.
 */
export function RefreshDataDialog({ open, onClose, role }: RefreshDataDialogProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const started = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Seconds since the run last advanced (percent, step or status): drives the "waiting" line and the non-blocking "slow" state (D-AD).
  const [quiet, setQuiet] = useState(0);
  const advancedAt = useRef(Date.now());

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

  // Seconds since the dialog opened (manager's discreet line); it stops when the run ends.
  useEffect(() => {
    if (!open) {
      setElapsed(0);
      setDetailsOpen(false);
      return undefined;
    }
    if (done) return undefined;
    const startedAt = Date.now() - elapsed * 1000;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, done]);

  // Once finished: every screen reads the server again, and the age shown in the menu is refreshed.
  const reloaded = useRef<string | null>(null);
  useEffect(() => {
    if (!done || refresh === undefined || reloaded.current === refresh.id) return;
    reloaded.current = refresh.id;
    void queryClient.invalidateQueries();
    void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus });
  }, [done, refresh, queryClient]);

  const percentNow = refresh === undefined ? 0 : "steps" in refresh ? stepProgress((refresh as SyncRefresh).steps).percent : refresh.progressPercent;
  const signature =
    refresh === undefined ? "none" : `${refresh.id}|${refresh.status}|${percentNow}|${"steps" in refresh ? (refresh as SyncRefresh).steps.map((step) => step.status[0]).join("") : refresh.phase}`;
  useEffect(() => {
    advancedAt.current = Date.now();
    setQuiet(0);
  }, [signature, open]);
  useEffect(() => {
    if (!open || done) return undefined;
    const timer = setInterval(() => setQuiet(Math.floor((Date.now() - advancedAt.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [open, done, signature]);

  const startError = start.isError ? describeApiError(start.error, "Não foi possível iniciar a atualização") : null;
  const loadError = progress.isError && !progress.data ? describeApiError(progress.error, "Não foi possível acompanhar a atualização") : null;
  const running = !startError && !done && !loadError;
  const stalled = running && quiet >= REFRESH_STALLED_AFTER_S;
  const busy = running && !stalled;

  const detail: SyncRefresh | null = refresh && "steps" in refresh ? (refresh as SyncRefresh) : null;
  const wantsDetail = detail !== null || (refresh === undefined && seesRefreshDetail(role));
  const hasWarnings = detail ? detail.steps.some((step) => step.status === "failed") : refresh !== undefined && "hasWarnings" in refresh && refresh.hasWarnings;
  const finishedAt = refresh?.finishedAt ? clockTime(refresh.finishedAt) : null;
  const retry = () => {
    advancedAt.current = Date.now();
    setQuiet(0);
    if (startError || hasWarnings || stalled) start.mutate();
    else void progress.refetch();
  };

  const steps = detail?.steps ?? [];
  const counted = stepProgress(steps);
  // Manager: finished steps / total. Seller: the API's progressPercent (the basic datum he may see).
  const percent = detail ? counted.percent : refresh && "progressPercent" in refresh ? refresh.progressPercent : 0;
  const current = detail ? currentStep(steps) : undefined;
  const phase = refresh && "phase" in refresh ? refresh.phase : "cadastros";
  const hasProgress = detail ? steps.some((step) => step.status !== "pending") : percent > 0;
  const waiting = running && !hasProgress && quiet >= REFRESH_WAITING_AFTER_S;
  const action = stalled
    ? "Está demorando mais que o normal. Os dados anteriores continuam disponíveis."
    : waiting
      ? "Aguardando o serviço de atualização…"
      : done
        ? hasWarnings
          ? wantsDetail
            ? "Atualização concluída com avisos"
            : "Não foi possível atualizar tudo agora."
          : finishedAt
            ? `Dados atualizados às ${finishedAt}`
            : "Dados atualizados"
        : current
          ? ENTITY_ACTION[current.entity]
          : detail || !refresh
            ? "Iniciando a atualização…"
            : PHASE_CAPTION[phase];
  const meta = detail ? `${counted.finished} de ${counted.total} · ${elapsed} s` : done && hasWarnings ? "Os dados anteriores continuam disponíveis. Tente de novo em instantes." : null;
  const showList = detail !== null && (detailsOpen || hasWarnings);

  const attention = Boolean(startError || loadError || hasWarnings || stalled);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        dismissible={false}
        className={wantsDetail ? "max-w-lg" : undefined}
        title={wantsDetail ? "Atualizando dados do Sankhya" : "Atualizando seus dados"}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        footer={
          busy ? undefined : attention ? (
            <>
              <Button variant="secondary" onClick={retry}>
                Tentar de novo
              </Button>
              <Button variant="primary" onClick={onClose}>
                Fechar
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onClose}>
              Concluir
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4">
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

          {startError || loadError ? null : <LoadingHero label="Progresso da atualização" percent={percent} action={action} meta={meta} outcome={done ? (hasWarnings ? "warn" : "ok") : null} />}

          {detail ? (
            <button
              type="button"
              className="mx-auto text-xs font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={showList}
              aria-controls="refresh-details"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {showList ? "Ocultar detalhes" : "Ver detalhes"}
            </button>
          ) : null}

          {detail && showList ? (
            <div id="refresh-details" className="flex max-h-64 flex-col gap-3 overflow-auto" aria-label="Andamento por informação" role="group">
              {REFRESH_GROUPS.map((group) => {
                const rows = group.entities.flatMap((entity) => steps.filter((step) => step.entity === entity));
                if (rows.length === 0) return null;
                return (
                  <StepGroup key={group.title} title={group.title}>
                    {rows.map((step) => (
                      <StepRow key={step.entity} state={STEP_STATE[step.status]} label={ENTITY_LABELS[step.entity]} value={stepCount(step)} note={stepNote(step)} />
                    ))}
                  </StepGroup>
                );
              })}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
