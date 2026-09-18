import { Inbox, Lock, RefreshCw, ServerCrash } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

interface StateShellProps extends Omit<ComponentProps<"div">, "title"> {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  compact?: boolean;
}

function StateShell({ icon, title, description, action, tone = "neutral", compact, className, children, ...props }: StateShellProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 text-center", compact ? "py-6" : "py-12", className)} {...props}>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 items-center justify-center rounded-full border border-dashed",
          tone === "danger" ? "border-danger text-danger" : "border-line-strong text-fg-muted",
        )}
      >
        {icon}
      </span>
      <p className="m-0 text-base font-semibold text-fg">{title}</p>
      {description ? <p className="m-0 max-w-md text-sm text-fg-muted">{description}</p> : null}
      {children}
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export interface EmptyStateProps extends Omit<ComponentProps<"div">, "title"> {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

/** No data / nothing matches the filters / feature not built yet. */
export function EmptyState({ icon, ...props }: EmptyStateProps) {
  return <StateShell icon={icon ?? <Inbox size={16} />} {...props} />;
}

export interface ErrorStateProps extends Omit<ComponentProps<"div">, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  /** Shows a "Tentar novamente" button. */
  onRetry?: () => void;
  retrying?: boolean;
  /** Correlation id returned by the API for support. */
  correlationId?: string;
  compact?: boolean;
}

/** Recoverable load error with retry. */
export function ErrorState({
  title = "Não foi possível carregar",
  description = "Tente novamente. Se o problema continuar, informe o código de correlação ao suporte.",
  onRetry,
  retrying,
  correlationId,
  compact,
  ...props
}: ErrorStateProps) {
  return (
    <StateShell
      role="alert"
      tone="danger"
      icon={<ServerCrash size={16} />}
      title={title}
      description={description}
      compact={compact}
      action={
        onRetry ? (
          <Button size="sm" onClick={onRetry} loading={retrying} leftIcon={<RefreshCw size={13} aria-hidden="true" />}>
            Tentar novamente
          </Button>
        ) : undefined
      }
      {...props}
    >
      {correlationId ? (
        <p className="m-0 text-xs text-fg-muted">
          Código de correlação: <span className="font-mono">{correlationId}</span>
        </p>
      ) : null}
    </StateShell>
  );
}

export type ForbiddenStateProps = Partial<Omit<EmptyStateProps, "icon">>;

/** 403: the server denied access. Never reveals what exists behind it. */
export function ForbiddenState({
  title = "Sem permissão",
  description = "Seu perfil não tem acesso a este conteúdo. Fale com o administrador se precisar dele.",
  ...props
}: ForbiddenStateProps) {
  return <StateShell icon={<Lock size={16} />} title={title} description={description} {...props} />;
}
