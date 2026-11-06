import { Alert, Button, Dialog, DialogContent, OutcomeMark, ProgressSteps, Spinner, StepGroup, StepRow } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { startSyncRefresh } from "../lib/api-mutations";
import { queryKeys, syncRefreshQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";
import {
  ENTITY_LABELS,
  PHASE_CAPTION,
  REFRESH_GROUPS,
  REFRESH_POLL_MS,
  STEP_STATE,
  clockTime,
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

  const detail: SyncRefresh | null = refresh && "steps" in refresh ? (refresh as SyncRefresh) : null;
  const wantsDetail = detail !== null || (refresh === undefined && seesRefreshDetail(role));
  const hasWarnings = detail ? detail.steps.some((step) => step.status === "failed") : refresh !== undefined && "hasWarnings" in refresh && refresh.hasWarnings;
  const finishedAt = refresh?.finishedAt ? clockTime(refresh.finishedAt) : null;
  const retry = () => (startError ? start.mutate() : hasWarnings ? start.mutate() : void progress.refetch());

  const steps = detail?.steps ?? [];
  const counted = stepProgress(steps);
  const percent = detail ? counted.percent : refresh && "progressPercent" in refresh ? refresh.progressPercent : 0;
  const runningGroup = detail ? REFRESH_GROUPS.find((group) => steps.some((step) => group.entities.includes(step.entity) && (step.status === "running" || step.status === "pending"))) : undefined;
  const phase = refresh && "phase" in refresh ? refresh.phase : runningGroup?.title === "Preços" ? "precos" : runningGroup?.title === "Financeiro e pedidos" ? "pedidos" : "cadastros";
  const caption = done ? PHASE_CAPTION.concluido : PHASE_CAPTION[phase];

  const attention = Boolean(startError || loadError || hasWarnings);

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

          {!startError && !loadError && refresh === undefined ? (
            <div className="flex items-center gap-2 text-sm text-fg-muted" role="status">
              <Spinner size={16} label="Iniciando" /> Iniciando…
            </div>
          ) : null}

          {refresh && !done ? (
            <ProgressSteps
              label="Progresso da atualização"
              value={percent}
              caption={caption}
              summary={detail ? `${counted.finished} de ${counted.total}` : undefined}
            />
          ) : null}

          {refresh && done ? (
            <div className="flex items-center gap-3" role="status">
              <OutcomeMark tone={hasWarnings ? "warn" : "ok"} />
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold text-fg">
                  {hasWarnings ? (wantsDetail ? "Atualização concluída com avisos" : "Não foi possível atualizar tudo agora.") : finishedAt ? `Dados atualizados às ${finishedAt}` : "Dados atualizados"}
                </p>
                <p className="m-0 mt-0.5 text-xs text-fg-muted">
                  {hasWarnings
                    ? wantsDetail
                      ? `${counted.finished} de ${counted.total} etapas${finishedAt ? ` · ${finishedAt}` : ""}. Os dados anteriores foram mantidos nas etapas com falha.`
                      : "Os dados anteriores continuam disponíveis. Tente de novo em instantes."
                    : detail
                      ? `${counted.total} etapas concluídas`
                      : null}
                </p>
              </div>
            </div>
          ) : null}

          {detail ? (
            <div className="flex flex-col gap-3" aria-label="Andamento por informação" role="group" aria-live="polite">
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
