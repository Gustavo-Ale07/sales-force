import type { ApiSchema } from "@salesforce/contracts/client";
import { ORDER_STAGE_LABELS, type OrderStageCode } from "@salesforce/domain";
import { Alert, Button, StatusBadge, StatusDot, type Tone } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  Ban,
  Check,
  Circle,
  CircleDot,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Hourglass,
  Landmark,
  PackageCheck,
  Send,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { syncRefreshQueryOptions } from "../lib/api-queries";
import { startSyncRefresh } from "../lib/api-mutations";
import { useApi } from "../lib/app-context";
import { clockTime } from "../lib/sync-refresh";

export type ErpStage = NonNullable<ApiSchema<"OrderDetail">["erpStage"]>;

/** Display order of the Sankhya cascade; the classification itself is the server's. */
const TIMELINE: readonly OrderStageCode[] = ["received", "in_review", "financial_check", "in_dispatch", "in_invoicing", "invoiced"];
const timelineLabel = (code: OrderStageCode): string => (code === "received" ? "Recebido" : ORDER_STAGE_LABELS[code]);

const stageIcons: Record<OrderStageCode, LucideIcon> = {
  sent_to_force: Send,
  send_error: XCircle,
  quotation: FileText,
  received: ClipboardCheck,
  in_review: Hourglass,
  financial_check: Landmark,
  in_dispatch: Truck,
  in_invoicing: PackageCheck,
  invoiced: FileCheck2,
};

const stageTones: Record<OrderStageCode, Tone> = {
  sent_to_force: "info",
  send_error: "danger",
  quotation: "neutral",
  received: "info",
  in_review: "info",
  financial_check: "warning",
  in_dispatch: "info",
  in_invoicing: "info",
  invoiced: "success",
};

/** Label of a stage code as the server names it (filter options, chips). */
export const stageText = (code: OrderStageCode): string => ORDER_STAGE_LABELS[code];

/** Chip with the server's stage; icon plus text, never colour alone. */
export function ErpStageChip({ stage, variant = "badge" }: { stage: ErpStage; variant?: "badge" | "dot" }) {
  const Icon = stageIcons[stage.stage];
  const icon = <Icon size={variant === "badge" ? 13 : 15} strokeWidth={2} aria-hidden="true" />;
  const label = stage.pendingSector ? `${stage.label} · ${stage.pendingSector}` : stage.label;
  return variant === "badge" ? (
    <StatusBadge tone={stageTones[stage.stage]} icon={icon}>
      {label}
    </StatusBadge>
  ) : (
    <StatusDot tone={stageTones[stage.stage]} icon={icon}>
      {label}
    </StatusDot>
  );
}

/** Re-reads the status: starts the data refresh, follows it, then reloads every query (orders included). */
export function useRefreshStage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const start = useMutation({ mutationFn: () => startSyncRefresh(api) });
  const refreshId = start.data?.id ?? null;
  const progress = useQuery({
    ...syncRefreshQueryOptions(api, refreshId ?? ""),
    enabled: refreshId !== null,
    refetchInterval: (state) => (state.state.data?.status === "done" ? false : 1500),
    staleTime: 0,
  });
  const status = progress.data?.status ?? start.data?.status;
  const done = status === "done";
  const reloaded = useRef<string | null>(null);
  useEffect(() => {
    if (!done || refreshId === null || reloaded.current === refreshId) return;
    reloaded.current = refreshId;
    void queryClient.invalidateQueries();
  }, [done, refreshId, queryClient]);
  const running = start.isPending || (refreshId !== null && !done);
  return { refresh: () => start.mutate(), running, failed: start.isError };
}

/** Situation in Sankhya on the order detail: stage line, 6-stage timeline, numbers and the read-error retry. */
export function ErpStagePanel({ stage }: { stage: ErpStage }) {
  const { refresh, running, failed } = useRefreshStage();
  const code = stage.stage;
  const when = stage.checkedAt ?? stage.updatedAt;
  const current = TIMELINE.indexOf(code);
  const forceSide = code === "sent_to_force" || code === "send_error";
  const Icon = stageIcons[code];
  return (
    <section aria-label="Situação no Sankhya" className="mb-3 rounded-[12px] bg-surface-2 px-4 py-3 text-sm" data-testid="erp-stage">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon size={15} strokeWidth={2} aria-hidden="true" className={code === "send_error" ? "text-danger" : "text-fg-muted"} />
        <span className="font-semibold">
          {forceSide ? stage.label : `Situação no Sankhya: ${stage.label}`}
          {stage.pendingSector ? ` · ${stage.pendingSector}` : ""}
        </span>
        <span className="text-fg-muted">· atualizado em {clockTime(when)}</span>
      </p>
      {code === "quotation" ? (
        <p className="m-0 mt-1 text-fg-muted">{stage.nunota !== null ? `Nº ${stage.nunota}` : null}</p>
      ) : (
        <>
          {current >= 0 ? (
            <ol className="m-0 mt-2 flex list-none flex-wrap gap-x-5 gap-y-1 p-0" aria-label="Etapas no Sankhya">
              {TIMELINE.map((step, index) => {
                const state = index < current ? "done" : index === current ? "current" : "next";
                const StepIcon = state === "done" ? Check : state === "current" ? CircleDot : Circle;
                return (
                  <li
                    key={step}
                    aria-current={state === "current" ? "step" : undefined}
                    className={state === "current" ? "flex items-center gap-1.5 font-semibold text-fg" : "flex items-center gap-1.5 text-fg-muted"}
                  >
                    <StepIcon size={14} strokeWidth={2} aria-hidden="true" className={state === "done" ? "text-ok" : undefined} />
                    {timelineLabel(step)}
                    <span className="sr-only">{state === "done" ? " (concluído)" : state === "current" ? " (etapa atual)" : " (pendente)"}</span>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {stage.nunota !== null || stage.invoiceNumber !== null ? (
            <p className="m-0 mt-2 flex flex-wrap gap-x-4 text-fg-muted">
              {stage.nunota !== null ? <span>Pedido nº {stage.nunota}</span> : null}
              {stage.invoiceNumber !== null ? <span>Nota fiscal nº {stage.invoiceNumber}</span> : null}
            </p>
          ) : null}
        </>
      )}
      {stage.readError ? (
        <Alert
          tone="warning"
          icon={<Ban size={15} aria-hidden="true" />}
          className="mt-2"
          title="Não foi possível atualizar a situação no Sankhya"
          action={
            <Button size="sm" variant="secondary" loading={running} disabled={running} onClick={refresh}>
              Tentar de novo
            </Button>
          }
        >
          {failed ? "A atualização não foi iniciada." : `Mostrando a última situação, de ${clockTime(when)}.`}
        </Alert>
      ) : null}
    </section>
  );
}
