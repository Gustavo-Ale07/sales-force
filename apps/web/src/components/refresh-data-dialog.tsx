import { Button, FullScreenLoading } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { startSyncRefresh } from "../lib/api-mutations";
import { queryKeys, syncRefreshQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";
import {
  REFRESH_POLL_MS,
  REFRESH_STALLED_AFTER_S,
  REFRESH_WAITING_AFTER_S,
  clockTime,
  seesRefreshDetail,
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
  // Seconds since the run last advanced (percent, step or status): drives the "waiting" line and the non-blocking "slow" state (D-AD).
  const [quiet, setQuiet] = useState(0);
  const advancedAt = useRef(0);

  const start = useMutation({ mutationFn: () => startSyncRefresh(api) });
  const refreshId = start.data?.id ?? null;

  const progress = useQuery({
    ...syncRefreshQueryOptions(api, refreshId ?? ""),
    enabled: refreshId !== null,
    refetchInterval: (state) => (state.state.data?.status === "done" ? false : REFRESH_POLL_MS),
    staleTime: 0,
  });

  const { mutate: startRun, reset: resetRun } = start;
  useEffect(() => {
    if (!open) {
      started.current = false;
      resetRun();
      return;
    }
    if (started.current) return;
    started.current = true;
    startRun();
  }, [open, startRun, resetRun]);

  const refresh = progress.data ?? (start.data ? { ...start.data } : undefined);
  const done = refresh?.status === "done";

  // Once finished: every screen reads the server again, and the age shown in the menu is refreshed.
  const reloaded = useRef<string | null>(null);
  const finishedId = done ? refresh?.id : undefined;
  useEffect(() => {
    if (finishedId === undefined || reloaded.current === finishedId) return;
    reloaded.current = finishedId;
    void queryClient.invalidateQueries();
    void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus });
  }, [finishedId, queryClient]);

  const percentNow = refresh === undefined ? 0 : "steps" in refresh ? stepProgress((refresh as SyncRefresh).steps).percent : refresh.progressPercent;
  const signature =
    refresh === undefined ? "none" : `${refresh.id}|${refresh.status}|${percentNow}|${"steps" in refresh ? (refresh as SyncRefresh).steps.map((step) => step.status[0]).join("") : refresh.phase}`;
  useEffect(() => {
    advancedAt.current = Date.now();
    // Reset from a callback (not synchronously in the effect body).
    const reset = setTimeout(() => setQuiet(0), 0);
    return () => clearTimeout(reset);
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
  const retry = () => {
    advancedAt.current = Date.now();
    setQuiet(0);
    if (startError || hasWarnings || stalled) start.mutate();
    else void progress.refetch();
  };

  const steps = detail?.steps ?? [];
  // Manager: finished steps / total. Seller: the API's progressPercent (the basic datum he may see).
  const percent = detail ? stepProgress(steps).percent : refresh && "progressPercent" in refresh ? refresh.progressPercent : 0;
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
          : "Pronto"
        : "Sincronizando…";
  const dataTime = done && refresh?.finishedAt ? `Dados de ${clockTime(refresh.finishedAt)}` : null;
  const meta = done && hasWarnings ? "Os dados anteriores continuam disponíveis. Tente de novo em instantes." : dataTime;

  const attention = Boolean(startError || loadError || hasWarnings || stalled);

  const errorTitle = startError?.title ?? loadError?.title ?? null;
  const errorText = startError?.description ?? loadError?.description ?? null;
  const ghost = "border-white/50 bg-transparent text-white hover:bg-white/10";
  const solid = "border-transparent bg-white text-[var(--sf-navy)] hover:bg-white/90";

  return (
    <FullScreenLoading
      open={open}
      onClose={onClose}
      busy={busy}
      title={wantsDetail ? "Atualizando dados do Sankhya" : "Sincronizando"}
      label="Progresso da atualização"
      percent={percent}
      action={errorTitle ?? action}
      meta={errorText ?? meta}
      outcome={errorTitle ? "warn" : done ? (hasWarnings ? "warn" : "ok") : null}
      actions={
        busy ? undefined : attention ? (
          <>
            <Button variant="secondary" className={ghost} onClick={retry}>
              Tentar de novo
            </Button>
            <Button variant="primary" className={solid} onClick={onClose}>
              Fechar
            </Button>
          </>
        ) : (
          <Button variant="primary" className={solid} onClick={onClose}>
            Concluir
          </Button>
        )
      }
    />
  );
}
