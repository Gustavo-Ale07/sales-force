import type { ApiSchema } from "@salesforce/contracts/client";
import { StatusBadge, Tooltip, type Tone } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { readyQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";

export type IntegrationState = "unknown" | "ok" | "degraded" | "not_configured" | "down";

const presentation: Record<IntegrationState, { tone: Tone; label: string; hint: string }> = {
  unknown: { tone: "neutral", label: "Integração: sem dados", hint: "O estado da integração ainda não foi carregado." },
  ok: { tone: "success", label: "Integração: normal", hint: "Sincronização com o ERP em dia." },
  degraded: { tone: "warning", label: "Integração: degradada", hint: "O ERP está indisponível ou atrasado; os dados podem estar desatualizados." },
  not_configured: {
    tone: "neutral",
    label: "Integração: não configurada",
    hint: "O ERP ainda não está conectado a esta instalação; os dados exibidos podem ser de demonstração.",
  },
  down: { tone: "danger", label: "Integração: indisponível", hint: "Sem comunicação com o servidor ou com a integração." },
};

/** Maps `GET /ready` to a pill state: the service being not ready wins over the integration summary. */
export function integrationStateOf(ready: ApiSchema<"ReadyResponse"> | undefined, failed: boolean): IntegrationState {
  if (failed) return "down";
  if (!ready) return "unknown";
  if (ready.status === "not_ready") return "down";
  return ready.integration.state;
}

/** Integration-state slot for the top bar, fed by `GET /ready` (polled every minute). */
export function IntegrationPill({ state = "unknown", detail }: { state?: IntegrationState; detail?: string | null }) {
  const { tone, label, hint } = presentation[state];
  return (
    <Tooltip content={detail ? `${hint} ${detail}` : hint}>
      {/* Focusable so keyboard users can reach the explanatory tooltip (WCAG 1.4.13). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <span tabIndex={0} className="inline-flex rounded-full">
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </span>
    </Tooltip>
  );
}

export function ConnectedIntegrationPill() {
  const api = useApi();
  const ready = useQuery(readyQueryOptions(api));
  return <IntegrationPill state={integrationStateOf(ready.data, ready.isError)} detail={ready.data?.integration.message} />;
}
