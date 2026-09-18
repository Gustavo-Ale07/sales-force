import { StatusBadge, Tooltip, type Tone } from "@salesforce/ui";

export type IntegrationState = "unknown" | "ok" | "degraded" | "down";

const presentation: Record<IntegrationState, { tone: Tone; label: string; hint: string }> = {
  unknown: { tone: "neutral", label: "Integração: sem dados", hint: "O estado da integração ainda não foi carregado." },
  ok: { tone: "success", label: "Integração: normal", hint: "Sincronização com o ERP em dia." },
  degraded: { tone: "warning", label: "Integração: degradada", hint: "O ERP está indisponível ou atrasado; os dados podem estar desatualizados." },
  down: { tone: "danger", label: "Integração: indisponível", hint: "Sem comunicação com a integração." },
};

/** Integration-state slot for the top bar. The state is supplied by the caller (from `GET /ready` once wired). */
export function IntegrationPill({ state = "unknown" }: { state?: IntegrationState }) {
  const { tone, label, hint } = presentation[state];
  return (
    <Tooltip content={hint}>
      {/* Focusable so keyboard users can reach the explanatory tooltip (WCAG 1.4.13). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <span tabIndex={0} className="inline-flex rounded-full">
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </span>
    </Tooltip>
  );
}
